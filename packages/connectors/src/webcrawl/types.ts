/**
 * Webcrawl connector. Two modes per source row, selected at connect time:
 *
 *   1. `scrape` — A specific URL that the user knows they want. One Firecrawl
 *      `/v2/scrape` call per sync. The cheapest path: one round-trip, one
 *      page, one chunk batch.
 *
 *   2. `crawl` — A seed URL plus link-follow caps. Hits Firecrawl's async
 *      `/v2/crawl` then polls `/v2/crawl/{id}` until the job completes or
 *      we hit a wall-clock deadline. Returns a batch of pages we walk
 *      through the same chunker.
 *
 * Both modes write to `webcrawl-page` chunks keyed on the absolute URL of
 * each scraped page. The cursor (`{ pageHashes: Record<url, sha256> }`) is
 * mode-agnostic, so a source that gets reconfigured from scrape→crawl (or
 * vice versa) doesn't have to re-embed pages whose body hasn't changed.
 */

/** Discriminator stored on `sources.metadata.mode`. */
export type WebcrawlMode = 'scrape' | 'crawl';

/** `sources.metadata` shape for a `mode: 'scrape'` source row. */
export interface WebcrawlScrapeMetadata {
  mode: 'scrape';
  /** Absolute URL to scrape (e.g. `https://beglaubigt.de/faq`). */
  url: string;
}

/** `sources.metadata` shape for a `mode: 'crawl'` source row. */
export interface WebcrawlCrawlMetadata {
  mode: 'crawl';
  seedUrl: string;
  /** Hard cap on pages Firecrawl returns; we additionally cap at MAX_LIMIT. */
  limit: number;
  /** Link-follow depth from the seed; 0 means seed-only. */
  maxDepth: number;
  /** Glob patterns relative to the seed host (passed straight to Firecrawl). */
  includePaths?: string[];
  excludePaths?: string[];
}

export type WebcrawlMetadata = WebcrawlScrapeMetadata | WebcrawlCrawlMetadata;

/** One page returned from either Firecrawl endpoint. */
export interface FirecrawlPage {
  /** Canonical absolute URL of the page after redirects. */
  url: string;
  /** Markdown body (we request `formats: ['markdown']`). */
  markdown: string;
  /** Optional metadata Firecrawl ships alongside each page. */
  metadata?: {
    title?: string;
    description?: string;
    language?: string;
    statusCode?: number;
    sourceURL?: string;
  };
}

/** Response from `POST /v2/scrape`. */
export interface FirecrawlScrapeResponse {
  success: boolean;
  data: FirecrawlPage;
}

/** Response from `POST /v2/crawl` — job-start envelope. */
export interface FirecrawlCrawlStartResponse {
  success: boolean;
  /** Opaque job identifier the worker polls. */
  id: string;
  url?: string;
}

/** Response from `GET /v2/crawl/{id}` — job status + paginated results. */
export interface FirecrawlCrawlStatusResponse {
  status: 'scraping' | 'completed' | 'failed' | 'cancelled';
  completed?: number;
  total?: number;
  /** Cursor URL for the next page of results, when the result set is paginated. */
  next?: string | null;
  data: FirecrawlPage[];
  error?: string;
}
