import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  defineConnector,
  none,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  fetchLlmsIndex,
  fetchPageMarkdown,
  normalizeBaseUrl,
  probeOpenApi,
} from './api';
import { emitOpenApiChunks, emitPageChunks } from './chunking';

export interface MintlifySpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const pagesCursorSchema = z
  .object({
    /**
     * Map of `path → SHA256 hash of the page's markdown` from the last
     * sync. Pages whose markdown hashes haven't moved get skipped on
     * incremental runs. Mintlify doesn't expose `last_modified` on
     * pages, so a content-hash watermark is the simplest reliable
     * mechanism — same dedup story as the framework's chunk-level
     * existing-hash set, just applied at the page boundary.
     */
    pageHashes: z.record(z.string(), z.string()).default({}),
  })
  .default({ pageHashes: {} });

const openapiCursorSchema = z
  .object({
    /** SHA256 hash of the spec body from the last sync. */
    specHash: z.string().optional(),
  })
  .default({});

type PagesCursor = z.infer<typeof pagesCursorSchema>;
type OpenApiCursor = z.infer<typeof openapiCursorSchema>;

/** SHA256 hex digest using the framework's environment (Node crypto). */
async function sha256(text: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Pull the docs `baseUrl` off the source row's metadata. The connect
 * route writes `{ baseUrl: '<url>' }` when a user adds a new docs site;
 * the framework's `ctx.sourceMetadata` surfaces it here. Throws a clear
 * setup error if missing — that means a sources row was created without
 * the connect route running.
 */
function requireBaseUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['baseUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Mintlify source ${ctx.sourceId} has no baseUrl in metadata`,
      fix: 'Reconnect the docs site via /connections so the source row is initialised correctly.',
    });
  }
  return normalizeBaseUrl(url);
}

export function createMintlifySpec(opts: MintlifySpecOptions = {}): ConnectorSpec {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return defineConnector({
    id: 'mintlify',
    displayName: 'Mintlify Docs',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.mintlify },

    auth: none(),

    http: {
      // Unused at runtime — both resources fetch absolute URLs through their
      // own helper functions because the per-source baseUrl lives on
      // sources.metadata, not at spec construction time. Populated so the
      // framework's HttpClient is constructible for testConnection.
      baseUrl: 'https://example.invalid',
    },

    async testConnection(_ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // testConnection is invoked by the connect route, which has the URL
      // in-hand and already validated reachability before persisting. The
      // framework still requires a result, so return a placeholder; the
      // connect route overrides externalId/name from its own probe.
      return {
        externalId: 'mintlify',
        name: 'Mintlify Docs',
      };
    },

    resources: [
      {
        id: 'pages',
        displayName: 'Documentation pages',
        cursorSchema: pagesCursorSchema,
        async sync(ctx: ResourceSyncContext<PagesCursor>): Promise<PagesCursor> {
          const baseUrl = requireBaseUrl(ctx);
          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Fetching llms.txt index…',
          });

          const index = await fetchLlmsIndex(baseUrl, fetchImpl);
          if (index.pages.length === 0) return ctx.cursor;

          const nextHashes: Record<string, string> = { ...ctx.cursor.pageHashes };
          const total = index.pages.length;

          for (let i = 0; i < index.pages.length; i += 1) {
            ctx.signal?.throwIfAborted();
            const entry = index.pages[i]!;
            ctx.reportProgress?.({
              current: i + 1,
              total,
              message: `Fetching ${entry.title}`,
            });

            // Per-page errors (TLS handshake failures, transient 5xx, DNS
            // hiccups) shouldn't abort a sync that's already indexed hundreds
            // of pages. Log + skip; the page will retry on the next
            // scheduled run since its hash never landed in the cursor.
            let markdown: string | null;
            try {
              markdown = await fetchPageMarkdown(baseUrl, entry.path, fetchImpl);
            } catch (err) {
              console.warn(
                `[mintlify] skipping ${entry.path} after fetch error: ${(err as Error).message}`,
              );
              continue;
            }
            if (!markdown) continue;

            const hash = await sha256(markdown);
            if (ctx.cursor.pageHashes[entry.path] === hash) {
              // Page hasn't changed since last sync — skip chunking + upsert.
              continue;
            }

            await emitPageChunks(ctx, { baseUrl, entry, markdown });
            nextHashes[entry.path] = hash;

            // Per-page checkpoint so a long sync doesn't lose progress on crash.
            await ctx.flushCursor({ pageHashes: nextHashes });
          }

          return { pageHashes: nextHashes };
        },
      },
      {
        id: 'openapi',
        displayName: 'OpenAPI endpoints',
        cursorSchema: openapiCursorSchema,
        async sync(ctx: ResourceSyncContext<OpenApiCursor>): Promise<OpenApiCursor> {
          const baseUrl = requireBaseUrl(ctx);
          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Probing OpenAPI…',
          });

          const probe = await probeOpenApi(baseUrl, fetchImpl);
          if (!probe) {
            // Most Mintlify sites without an API reference have no OpenAPI
            // spec at the conventional paths. Silent no-op — the resource
            // ran, found nothing, leaves the cursor as-is.
            return ctx.cursor;
          }

          const specBody = JSON.stringify(probe.spec);
          const hash = await sha256(specBody);
          if (hash === ctx.cursor.specHash) return ctx.cursor;

          await emitOpenApiChunks(ctx, {
            baseUrl,
            specUrl: probe.url,
            spec: probe.spec,
          });

          return { specHash: hash };
        },
      },
    ],

    ui: {
      description: 'Public Mintlify-hosted docs (pages + OpenAPI reference).',
      category: 'docs',
    },
  });
}
