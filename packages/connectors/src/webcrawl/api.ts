/**
 * Firecrawl v2 API client. Raw fetch — Firecrawl ships an official SDK
 * (`@mendable/firecrawl-js`) but the surface we need is three endpoints,
 * all simple POST/GET against `api.firecrawl.dev/v2/*`. Matching Mintlify's
 * and Prismic's no-SDK pattern keeps the dependency surface small.
 *
 * Endpoint reference (verify against https://docs.firecrawl.dev before merge):
 *   - POST /v2/scrape      → `{ url, formats: ['markdown'], ... }` → page
 *   - POST /v2/crawl       → `{ url, limit, maxDiscoveryDepth, ... }` → { id }
 *   - GET  /v2/crawl/{id}  → status + page batch (+ optional `next` URL)
 *   - DELETE /v2/crawl/{id} → cancel an in-flight crawl
 */
import { ErrorCode, holoError } from '@holo/errors';
import type {
  FirecrawlCrawlStartResponse,
  FirecrawlCrawlStatusResponse,
  FirecrawlPage,
  FirecrawlScrapeResponse,
} from './types';

export const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v2';

/**
 * Hard upper bound on pages per crawl regardless of what the user requests.
 * Firecrawl bills per page; this is the ceiling we let one source row burn
 * on a single sync. Users wanting more should split into multiple seed rows.
 */
export const MAX_CRAWL_LIMIT = 500;

/**
 * Wall-clock deadline for inline crawl polling. Firecrawl crawls of <100
 * pages typically finish in well under a minute; this gives a comfortable
 * margin for slow target hosts without letting a single sync run forever
 * and starve the worker's queue concurrency.
 */
export const CRAWL_DEADLINE_MS = 5 * 60 * 1000;

/** Poll interval between `GET /v2/crawl/{id}` calls inside one sync run. */
export const CRAWL_POLL_INTERVAL_MS = 5_000;

export interface FirecrawlClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Override base URL (tests / self-hosted Firecrawl). */
  baseUrl?: string;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function fetchOk<T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`Firecrawl ${url} returned ${res.status}: ${body.slice(0, 200)}`),
      { status: res.status },
    );
  }
  return (await res.json()) as T;
}

/**
 * `POST /v2/scrape` — single-URL fetch returning markdown. Returns null if
 * Firecrawl reports a successful call but no page body (rare; means the
 * target was unreachable or returned a non-HTML body that Firecrawl
 * couldn't extract). Callers treat null the same as "skip this URL".
 */
export async function scrapePage(
  opts: FirecrawlClientOptions,
  input: { url: string },
): Promise<FirecrawlPage | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? FIRECRAWL_API_BASE;
  const body = await fetchOk<FirecrawlScrapeResponse>(
    `${baseUrl}/scrape`,
    {
      method: 'POST',
      headers: authHeaders(opts.apiKey),
      body: JSON.stringify({
        url: input.url,
        formats: ['markdown'],
      }),
    },
    fetchImpl,
  );
  if (!body.success || !body.data?.markdown) return null;
  return body.data;
}

export interface StartCrawlInput {
  seedUrl: string;
  limit: number;
  maxDepth: number;
  includePaths?: string[] | undefined;
  excludePaths?: string[] | undefined;
}

/** `POST /v2/crawl` — kick off an async crawl. Returns the job id. */
export async function startCrawl(
  opts: FirecrawlClientOptions,
  input: StartCrawlInput,
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? FIRECRAWL_API_BASE;
  const payload: Record<string, unknown> = {
    url: input.seedUrl,
    limit: Math.min(input.limit, MAX_CRAWL_LIMIT),
    // Firecrawl v2 renamed `maxDepth` → `maxDiscoveryDepth` (depth based on
    // discovery order, where the seed + sitemapped pages are depth 0).
    maxDiscoveryDepth: input.maxDepth,
    // Same-origin only. Letting Firecrawl follow off-host links would pull
    // in random third-party pages users never asked us to index.
    allowExternalLinks: false,
    scrapeOptions: { formats: ['markdown'] },
  };
  if (input.includePaths && input.includePaths.length > 0) {
    payload['includePaths'] = input.includePaths;
  }
  if (input.excludePaths && input.excludePaths.length > 0) {
    payload['excludePaths'] = input.excludePaths;
  }
  const body = await fetchOk<FirecrawlCrawlStartResponse>(
    `${baseUrl}/crawl`,
    {
      method: 'POST',
      headers: authHeaders(opts.apiKey),
      body: JSON.stringify(payload),
    },
    fetchImpl,
  );
  if (!body.success || !body.id) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Firecrawl /crawl did not return a job id for ${input.seedUrl}`,
      fix: 'Check the Firecrawl dashboard for the failed request; the seed URL may be unreachable or blocked by robots.txt.',
    });
  }
  return body.id;
}

/** One page of `GET /v2/crawl/{id}` results. */
export async function getCrawlStatus(
  opts: FirecrawlClientOptions,
  jobId: string,
  /** Pass the `next` cursor URL from a prior status response to advance pages. */
  cursorUrl?: string,
): Promise<FirecrawlCrawlStatusResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? FIRECRAWL_API_BASE;
  const url = cursorUrl ?? `${baseUrl}/crawl/${encodeURIComponent(jobId)}`;
  return fetchOk<FirecrawlCrawlStatusResponse>(
    url,
    { method: 'GET', headers: authHeaders(opts.apiKey) },
    fetchImpl,
  );
}

/** `DELETE /v2/crawl/{id}` — best-effort cancellation. */
export async function cancelCrawl(
  opts: FirecrawlClientOptions,
  jobId: string,
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? FIRECRAWL_API_BASE;
  await fetchImpl(`${baseUrl}/crawl/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: authHeaders(opts.apiKey),
  });
}

/**
 * Drive an async crawl job to completion inside a single sync run. Polls
 * `getCrawlStatus` every `CRAWL_POLL_INTERVAL_MS` until the job reports
 * `completed`/`failed`/`cancelled`, then walks any remaining `next` cursor
 * pages to yield every page Firecrawl produced.
 *
 * Yields pages as they're discovered so the spec can checkpoint the cursor
 * between pages without buffering the whole crawl in memory.
 *
 * Honours `signal` between polls and between cursor pages. On signal abort,
 * issues a best-effort DELETE to free Firecrawl resources.
 */
export async function* iterateCrawlPages(
  opts: FirecrawlClientOptions,
  jobId: string,
  controls: {
    deadlineMs?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    /**
     * Test seam — overrides the wall-clock wait between polls. Default uses
     * `setTimeout`; tests inject a synchronous resolver.
     */
    waitFn?: (ms: number) => Promise<void>;
  } = {},
): AsyncGenerator<FirecrawlPage, void, void> {
  const deadline = Date.now() + (controls.deadlineMs ?? CRAWL_DEADLINE_MS);
  const pollInterval = controls.pollIntervalMs ?? CRAWL_POLL_INTERVAL_MS;
  const wait = controls.waitFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // Phase 1: poll until terminal. Yield any pages the status response
  // already contains (Firecrawl streams partial results on the first page).
  let status: FirecrawlCrawlStatusResponse | null = null;
  let nextCursor: string | undefined;
  const seen = new Set<string>();
  while (true) {
    controls.signal?.throwIfAborted();
    if (Date.now() > deadline) {
      // Abandon the job. The crawl may still finish on Firecrawl's side; the
      // next sync will re-issue with the same seed (Firecrawl dedups within
      // a job, not across jobs — that's fine, our cursor hash-dedupes).
      await cancelCrawl(opts, jobId).catch(() => {});
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Firecrawl crawl ${jobId} did not finish within ${(controls.deadlineMs ?? CRAWL_DEADLINE_MS) / 1000}s`,
        fix: 'Lower `limit` / `maxDepth` on the source, or split into multiple seed URLs.',
      });
    }
    status = await getCrawlStatus(opts, jobId);
    for (const page of status.data) {
      if (page.markdown && page.url && !seen.has(page.url)) {
        seen.add(page.url);
        yield page;
      }
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Firecrawl crawl ${jobId} ended with status ${status.status}: ${status.error ?? 'no detail'}`,
        fix: 'Check the seed URL is reachable and not blocked by robots.txt.',
      });
    }
    if (status.status === 'completed') {
      nextCursor = status.next ?? undefined;
      break;
    }
    await wait(pollInterval);
  }

  // Phase 2: walk the `next` cursor through any remaining result pages.
  while (nextCursor) {
    controls.signal?.throwIfAborted();
    const page = await getCrawlStatus(opts, jobId, nextCursor);
    for (const p of page.data) {
      if (p.markdown && p.url && !seen.has(p.url)) {
        seen.add(p.url);
        yield p;
      }
    }
    nextCursor = page.next ?? undefined;
  }
}

/**
 * Resolve + reject private/loopback URLs in a host-process-safe way. Wraps
 * the framework's `assertPublicHttpUrl` indirection so the connect route +
 * spec don't need to import the framework directly — keeps the boundary
 * with the connector-framework consistent with the other connectors.
 */
export function normalizeSeedUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}
