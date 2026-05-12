import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  createHttpClient,
  defineConnector,
  type ConnectorSpec,
  type HttpConfig,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  buildPagesCql,
  fetchCurrentUser,
  searchContent,
  searchSpaces,
} from './api';
import { processPage, processSpace } from './chunking';

export interface ConfluenceSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const pagesCursorSchema = z
  .object({
    /** Highest `version.when` timestamp we've ingested. */
    updatedAt: z.string().optional(),
  })
  .default({});

const spacesCursorSchema = z.object({}).default({});

type PagesCursor = z.infer<typeof pagesCursorSchema>;
type SpacesCursor = z.infer<typeof spacesCursorSchema>;

const PLACEHOLDER_BASE_URL = 'https://example.invalid';

const PER_TENANT_HTTP: Omit<HttpConfig, 'baseUrl'> = {
  // Atlassian's dynamic rate limits + Retry-After on 429. Conservative
  // bucket here; framework absorbs anything the API pushes back on.
  rateLimit: { rps: 5, burst: 20 },
  retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
};

function requireSiteUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['siteUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Confluence source ${ctx.sourceId} has no siteUrl in metadata`,
      fix: 'Reconnect Confluence via /connections so the source row is initialised correctly.',
    });
  }
  return url;
}

export function createConfluenceSpec(opts: ConfluenceSpecOptions = {}): ConnectorSpec {
  const auth = apiKey({ prefix: 'Basic ' });
  const fetchImpl = opts.fetchImpl;

  return defineConnector({
    id: 'confluence',
    displayName: 'Confluence',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.confluence },

    auth,

    http: {
      // Placeholder. Every resource constructs its own per-tenant client
      // below — the per-tenant siteUrl lives on sources.metadata and isn't
      // available at spec-construction time. Mirrors the Jira spec.
      baseUrl: PLACEHOLDER_BASE_URL,
      ...PER_TENANT_HTTP,
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const me = await fetchCurrentUser(ctx.api);
      return {
        externalId: me.accountId,
        name: me.displayName,
        raw: { accountId: me.accountId, email: me.email },
      };
    },

    resources: [
      {
        id: 'pages',
        displayName: 'Pages',
        cursorSchema: pagesCursorSchema,
        async sync(ctx: ResourceSyncContext<PagesCursor>): Promise<PagesCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          const cql = buildPagesCql(ctx.cursor.updatedAt);
          const limit = 25;
          let start = 0;
          let pageNum = 0;
          let highestUpdatedAt = ctx.cursor.updatedAt;

          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching pages · batch ${pageNum}`,
            });

            const batch = await searchContent(api, { cql, start, limit });

            for (const page of batch.results) {
              ctx.signal?.throwIfAborted();
              await processPage(ctx, page, siteUrl);
              const when = page.version?.when;
              if (when && (!highestUpdatedAt || when > highestUpdatedAt)) {
                highestUpdatedAt = when;
              }
            }

            if (highestUpdatedAt) {
              await ctx.flushCursor({ updatedAt: highestUpdatedAt });
            }

            // Confluence v1 signals end-of-list via missing `_links.next`
            // *or* a short page. Honor both — the API has been observed to
            // omit `_links.next` mid-listing when `totalSize` is unknown.
            const hasMore =
              !!batch._links?.next && batch.results.length === limit;
            if (!hasMore) break;
            start += batch.results.length;
          }

          return { updatedAt: highestUpdatedAt };
        },
      },
      {
        id: 'spaces',
        displayName: 'Spaces',
        cursorSchema: spacesCursorSchema,
        async sync(ctx: ResourceSyncContext<SpacesCursor>): Promise<SpacesCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          const limit = 50;
          let start = 0;
          let pageNum = 0;
          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching spaces · batch ${pageNum}`,
            });

            const batch = await searchSpaces(api, { start, limit });
            for (const space of batch.results) {
              ctx.signal?.throwIfAborted();
              await processSpace(ctx, space, siteUrl);
            }
            if (batch.results.length < limit) break;
            start += batch.results.length;
          }
          return {};
        },
      },
    ],

    ui: {
      description: 'Spaces, pages, and inline comments from Confluence Cloud.',
      category: 'docs',
    },
  });
}
