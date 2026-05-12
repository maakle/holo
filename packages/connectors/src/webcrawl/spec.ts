import { z } from 'zod';
import { createHash } from 'node:crypto';
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
  iterateCrawlPages,
  scrapePage,
  startCrawl,
  type FirecrawlClientOptions,
} from './api';
import { emitPageChunks } from './chunking';
import type {
  FirecrawlPage,
  WebcrawlCrawlMetadata,
  WebcrawlMetadata,
  WebcrawlScrapeMetadata,
} from './types';

export interface WebcrawlSpecOptions {
  /** Firecrawl API key. Required at boot; sourced from `FIRECRAWL_API_KEY`. */
  apiKey: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override Firecrawl base URL (self-hosted / tests). */
  baseUrl?: string;
  /** Test seam — replaces the inter-poll wait. */
  waitFn?: (ms: number) => Promise<void>;
}

const cursorSchema = z
  .object({
    /**
     * Map of `url → SHA256 hash of the page's markdown` from the last sync.
     * Pages whose hashes haven't moved skip re-emission. Same dedup
     * mechanism Mintlify uses, just keyed on absolute URL instead of path
     * (a webcrawl source can span multiple hosts via crawl mode).
     */
    pageHashes: z.record(z.string(), z.string()).default({}),
  })
  .default({ pageHashes: {} });

type WebcrawlCursor = z.infer<typeof cursorSchema>;

const scrapeMetadataSchema = z.object({
  mode: z.literal('scrape'),
  url: z.string().url(),
});

const crawlMetadataSchema = z.object({
  mode: z.literal('crawl'),
  seedUrl: z.string().url(),
  limit: z.number().int().positive(),
  maxDepth: z.number().int().min(0),
  includePaths: z.array(z.string()).optional(),
  excludePaths: z.array(z.string()).optional(),
});

const metadataSchema = z.discriminatedUnion('mode', [
  scrapeMetadataSchema,
  crawlMetadataSchema,
]);

/**
 * Pull + validate `sources.metadata`. Throws a typed setup error if the row
 * was inserted outside the connect route (or hasn't been migrated to the
 * discriminated-union shape). Matching the Mintlify pattern of failing
 * loudly at sync-start rather than half-running.
 */
function requireMetadata(ctx: ResourceSyncContext<unknown>): WebcrawlMetadata {
  const parsed = metadataSchema.safeParse(ctx.sourceMetadata);
  if (!parsed.success) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Webcrawl source ${ctx.sourceId} has invalid metadata: ${parsed.error.message}`,
      fix: 'Reconnect the website via /connections so the source row is initialised correctly.',
    });
  }
  return parsed.data;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Common per-page handling: hash check, emit, update cursor. Returns the
 * new hash map (mutated copy of the prior one). Pulled out so both the
 * scrape branch and the crawl branch share identical logic.
 */
async function processPage(
  ctx: ResourceSyncContext<WebcrawlCursor>,
  page: FirecrawlPage,
  mode: 'scrape' | 'crawl',
  seedUrl: string,
  hashes: Record<string, string>,
): Promise<void> {
  const hash = sha256Hex(page.markdown);
  if (hashes[page.url] === hash) return;
  await emitPageChunks(ctx, { page, mode, seedUrl });
  hashes[page.url] = hash;
}

export function createWebcrawlSpec(opts: WebcrawlSpecOptions): ConnectorSpec {
  const clientOpts: FirecrawlClientOptions = {
    apiKey: opts.apiKey,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  };

  return defineConnector({
    id: 'webcrawl',
    displayName: 'Website',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.webcrawl },

    auth: none(),

    http: {
      // Unused at runtime — the Firecrawl client builds full URLs itself
      // and uses the API key from `opts`. Populated so the framework's
      // HttpClient is constructible for testConnection.
      baseUrl: 'https://example.invalid',
    },

    async testConnection(_ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The connect route validates reachability before persisting; the
      // framework still needs a TestConnectionResult, so we return a
      // placeholder name that the route overrides from its probe.
      return { externalId: 'webcrawl', name: 'Website' };
    },

    resources: [
      {
        id: 'pages',
        displayName: 'Crawled pages',
        cursorSchema,
        async sync(ctx: ResourceSyncContext<WebcrawlCursor>): Promise<WebcrawlCursor> {
          if (!opts.apiKey) {
            throw holoError({
              code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
              problem: 'Webcrawl requires FIRECRAWL_API_KEY at worker boot',
              fix: 'Set FIRECRAWL_API_KEY in the worker environment.',
            });
          }
          const metadata = requireMetadata(ctx);
          const hashes: Record<string, string> = { ...ctx.cursor.pageHashes };

          if (metadata.mode === 'scrape') {
            return syncScrape(ctx, clientOpts, metadata, hashes);
          }
          return syncCrawl(ctx, clientOpts, metadata, hashes, opts.waitFn);
        },
      },
    ],

    ui: {
      description:
        'Scrape a specific list of pages, or crawl an entire website. Powered by Firecrawl.',
      category: 'docs',
    },
  });
}

async function syncScrape(
  ctx: ResourceSyncContext<WebcrawlCursor>,
  clientOpts: FirecrawlClientOptions,
  metadata: WebcrawlScrapeMetadata,
  hashes: Record<string, string>,
): Promise<WebcrawlCursor> {
  ctx.reportProgress?.({ current: 0, total: 1, message: `Scraping ${metadata.url}` });
  ctx.signal?.throwIfAborted();
  const page = await scrapePage(clientOpts, { url: metadata.url });
  if (!page) return { pageHashes: hashes };
  await processPage(ctx, page, 'scrape', metadata.url, hashes);
  ctx.reportProgress?.({ current: 1, total: 1, message: 'Scrape complete' });
  return { pageHashes: hashes };
}

async function syncCrawl(
  ctx: ResourceSyncContext<WebcrawlCursor>,
  clientOpts: FirecrawlClientOptions,
  metadata: WebcrawlCrawlMetadata,
  hashes: Record<string, string>,
  waitFn?: (ms: number) => Promise<void>,
): Promise<WebcrawlCursor> {
  ctx.reportProgress?.({
    current: 0,
    total: metadata.limit,
    message: `Starting crawl of ${metadata.seedUrl}`,
  });

  const jobId = await startCrawl(clientOpts, {
    seedUrl: metadata.seedUrl,
    limit: metadata.limit,
    maxDepth: metadata.maxDepth,
    includePaths: metadata.includePaths,
    excludePaths: metadata.excludePaths,
  });

  let processed = 0;
  for await (const page of iterateCrawlPages(clientOpts, jobId, {
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    ...(waitFn ? { waitFn } : {}),
  })) {
    ctx.signal?.throwIfAborted();
    processed += 1;
    ctx.reportProgress?.({
      current: processed,
      total: metadata.limit,
      message: `Indexed ${page.url}`,
    });
    try {
      await processPage(ctx, page, 'crawl', metadata.seedUrl, hashes);
    } catch (err) {
      // One bad page shouldn't kill the crawl — Firecrawl already produced
      // the markdown, so a downstream chunker / upsert error is on us.
      console.warn(
        `[webcrawl] skipping ${page.url} after error: ${(err as Error).message}`,
      );
    }
    // Per-page checkpoint so a long crawl doesn't lose progress on crash.
    await ctx.flushCursor({ pageHashes: hashes });
  }

  return { pageHashes: hashes };
}
