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
  fetchRepository,
  getMasterRef,
  isValidRepoName,
  iterateDocuments,
} from './api';
import { emitDocumentChunks } from './chunking';

export interface PrismicSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const documentsCursorSchema = z
  .object({
    /**
     * Master ref ID of the repo at the last successful sync. Prismic mints a
     * new ref on every publish, so `currentRef === lastRef` means the repo
     * hasn't been published since we last looked — short-circuit the whole
     * page-through.
     */
    lastRef: z.string().optional(),
    /**
     * Wall-clock checkpoint used in the `date.after(...)` predicate to fetch
     * only documents published since the previous sync. Updated to "now" at
     * the end of every successful run.
     */
    lastSyncedAt: z.string().optional(),
  })
  .default({});

type DocumentsCursor = z.infer<typeof documentsCursorSchema>;

/**
 * Pull the Prismic repo slug + optional PAT off the source row's metadata.
 * The connect route writes both; missing repo is a setup error (someone
 * inserted a sources row outside the connect flow).
 */
function requireSourceConfig(
  ctx: ResourceSyncContext<unknown>,
): { repo: string; accessToken: string | undefined } {
  const repo = ctx.sourceMetadata['repo'];
  if (typeof repo !== 'string' || !isValidRepoName(repo)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Prismic source ${ctx.sourceId} has no valid repo in metadata`,
      fix: 'Reconnect the Prismic repo via /connections so the source row is initialised correctly.',
    });
  }
  const rawToken = ctx.sourceMetadata['accessToken'];
  const accessToken =
    typeof rawToken === 'string' && rawToken.length > 0 ? rawToken : undefined;
  return { repo, accessToken };
}

export function createPrismicSpec(opts: PrismicSpecOptions = {}): ConnectorSpec {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return defineConnector({
    id: 'prismic',
    displayName: 'Prismic',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.prismic },

    auth: none(),

    http: {
      // Unused — every resource builds the URL per-source from the repo slug.
      // Populated so HttpClient is constructible for the framework's bootstrap.
      baseUrl: 'https://example.invalid',
    },

    async testConnection(_ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The connect route is the validation surface — it hits /api/v2 and
      // confirms reachability + parseability before persisting. testConnection
      // is required by the framework but never the primary signal for this
      // spec; returning a placeholder is the same shape Mintlify uses.
      return { externalId: 'prismic', name: 'Prismic' };
    },

    resources: [
      {
        id: 'documents',
        displayName: 'Published documents',
        cursorSchema: documentsCursorSchema,
        async sync(ctx: ResourceSyncContext<DocumentsCursor>): Promise<DocumentsCursor> {
          const { repo, accessToken } = requireSourceConfig(ctx);

          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Fetching repository metadata…',
          });

          const repository = await fetchRepository(repo, accessToken, fetchImpl);
          const currentRef = getMasterRef(repository);
          if (ctx.cursor.lastRef === currentRef) {
            // No publish since last sync — Prismic's master ref is the cheapest
            // possible change detector. Cheaper than even one document fetch.
            return ctx.cursor;
          }

          // Capture "now" before the page-through so the next sync's
          // afterIso watermark doesn't miss publishes that land mid-run.
          const runStartedAt = new Date().toISOString();

          let processed = 0;
          for await (const doc of iterateDocuments(repo, currentRef, {
            ...(accessToken !== undefined ? { accessToken } : {}),
            ...(ctx.cursor.lastSyncedAt
              ? { afterIso: ctx.cursor.lastSyncedAt }
              : {}),
            fetchImpl,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          })) {
            ctx.signal?.throwIfAborted();
            processed += 1;
            ctx.reportProgress?.({
              current: processed,
              total: null,
              message: `Indexing ${doc.type}/${doc.uid ?? doc.id}`,
            });
            try {
              await emitDocumentChunks(ctx, { repo, doc });
            } catch (err) {
              // One bad document shouldn't kill a sync that's already indexed
              // hundreds. Log + skip; it'll retry on the next run since we
              // don't checkpoint per document — the cursor watermark only
              // advances at the end.
              console.warn(
                `[prismic] skipping ${doc.type}/${doc.id} after error: ${(err as Error).message}`,
              );
            }
          }

          return { lastRef: currentRef, lastSyncedAt: runStartedAt };
        },
      },
    ],

    ui: {
      description: 'Prismic CMS documents (FAQs, pages, blog posts, …).',
      category: 'docs',
    },
  });
}
