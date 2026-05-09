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
  fetchAllCategories,
  fetchAllSections,
  iterateArticlesIncremental,
  normalizeBaseUrl,
} from './api';
import { emitArticleChunks } from './chunking';

export interface ZendeskSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const articlesCursorSchema = z
  .object({
    /**
     * Highest `updated_at` (Unix seconds) we've ingested. The next sync
     * passes `start_time = updatedAt` to Zendesk's incremental export
     * endpoint, which returns only articles updated AT OR AFTER that time.
     * Same article may come back unchanged on the boundary tick — the
     * framework's content-hash dedup absorbs it.
     */
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .default({});

type ArticlesCursor = z.infer<typeof articlesCursorSchema>;

/**
 * Read the help-center base URL off the per-source metadata. The connect
 * route writes `{ baseUrl }` when the user adds a help center. Throws a
 * clear setup error if missing — that means a sources row was created
 * without going through the connect handler.
 */
function requireBaseUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['baseUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Zendesk source ${ctx.sourceId} has no baseUrl in metadata`,
      fix: 'Reconnect the help center via /connections so the source row is initialised correctly.',
    });
  }
  return normalizeBaseUrl(url);
}

export function createZendeskSpec(opts: ZendeskSpecOptions = {}): ConnectorSpec {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return defineConnector({
    id: 'zendesk',
    displayName: 'Zendesk Help Center',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.zendesk },

    auth: none(),

    http: {
      // Unused at runtime — the spec owns its fetches because the per-source
      // baseUrl lives on `sources.metadata`, not at spec construction. Set
      // to a placeholder so the framework's HttpClient is constructible
      // for testConnection.
      baseUrl: 'https://example.invalid',
    },

    async testConnection(_ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // testConnection is invoked by the connect route, which has already
      // validated the URL by hitting the API. The framework still requires
      // a result, so return a placeholder; the connect route fills in real
      // identity from its own probe.
      return {
        externalId: 'zendesk',
        name: 'Zendesk Help Center',
      };
    },

    resources: [
      {
        id: 'articles',
        displayName: 'Help center articles',
        cursorSchema: articlesCursorSchema,
        async sync(ctx: ResourceSyncContext<ArticlesCursor>): Promise<ArticlesCursor> {
          const baseUrl = requireBaseUrl(ctx);
          const startTime = ctx.cursor.updatedAt ?? 0;

          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Loading help center hierarchy…',
          });

          // Sections + categories are small (typically <100 each on a
          // help center). Fetched once at sync start and cached for
          // breadcrumb attachment.
          const [sections, categories] = await Promise.all([
            fetchAllSections(baseUrl, { fetchImpl }),
            fetchAllCategories(baseUrl, { fetchImpl }),
          ]);

          let highestUpdatedAt = ctx.cursor.updatedAt ?? 0;
          let pageNum = 0;
          let articleCount = 0;

          for await (const page of iterateArticlesIncremental(baseUrl, startTime, {
            fetchImpl,
          })) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Indexing articles · page ${pageNum}`,
            });

            for (const article of page.articles) {
              ctx.signal?.throwIfAborted();
              await emitArticleChunks(ctx, {
                baseUrl,
                article,
                sections,
                categories,
              });
              articleCount += 1;
              const ts = Math.floor(new Date(article.updated_at).getTime() / 1000);
              if (ts > highestUpdatedAt) highestUpdatedAt = ts;
            }

            // Per-page checkpoint so a long sweep doesn't lose progress on crash.
            await ctx.flushCursor({ updatedAt: highestUpdatedAt });
          }

          ctx.reportProgress?.({
            current: articleCount,
            total: articleCount,
            message: `Synced ${articleCount} article${articleCount === 1 ? '' : 's'}`,
          });
          return { updatedAt: highestUpdatedAt };
        },
      },
    ],

    ui: {
      description: 'Public Zendesk help center articles, with breadcrumb + section context.',
      category: 'support',
    },
  });
}
