/**
 * Zendesk Help Center API helpers — built on raw fetch, no Authorization
 * header (public help centers don't need one). Two listing strategies:
 *
 *   1. Incremental export — `/api/v2/help_center/incremental/articles.json
 *      ?start_time=<unix>` returns articles updated AT OR AFTER `start_time`.
 *      This is THE official path for keeping a content index in sync.
 *
 *   2. Sections + categories — `/api/v2/help_center/sections.json` and
 *      `/api/v2/help_center/categories.json`. Fetched once at sync start
 *      to build a (sectionId → name, categoryId → name) lookup so each
 *      article chunk can carry its breadcrumb.
 */
import type {
  ZendeskArticlesPage,
  ZendeskCategoriesPage,
  ZendeskSectionsPage,
} from './types';

/** Strip trailing slashes for safe path concatenation. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

interface FetchJsonOpts {
  fetchImpl?: typeof fetch;
}

async function fetchJson<T>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Zendesk ${url} returned ${res.status}`), {
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

/**
 * Iterate the incremental-articles export, yielding pages until the API
 * stops handing back a `next_page`. `startTime` is a Unix timestamp;
 * pass 0 for a full sweep.
 */
export async function* iterateArticlesIncremental(
  baseUrl: string,
  startTime: number,
  opts: FetchJsonOpts = {},
): AsyncGenerator<ZendeskArticlesPage> {
  const root = normalizeBaseUrl(baseUrl);
  let url: string | null = `${root}/api/v2/help_center/incremental/articles.json?start_time=${startTime}`;
  while (url) {
    const page: ZendeskArticlesPage = await fetchJson(url, opts);
    yield page;
    url = page.next_page;
  }
}

export async function fetchAllSections(
  baseUrl: string,
  opts: FetchJsonOpts = {},
): Promise<Map<number, { name: string; categoryId: number | null }>> {
  const root = normalizeBaseUrl(baseUrl);
  const out = new Map<number, { name: string; categoryId: number | null }>();
  let url: string | null = `${root}/api/v2/help_center/sections.json?per_page=100`;
  while (url) {
    const page: ZendeskSectionsPage = await fetchJson(url, opts);
    for (const s of page.sections) {
      out.set(s.id, { name: s.name, categoryId: s.category_id });
    }
    url = page.next_page;
  }
  return out;
}

export async function fetchAllCategories(
  baseUrl: string,
  opts: FetchJsonOpts = {},
): Promise<Map<number, string>> {
  const root = normalizeBaseUrl(baseUrl);
  const out = new Map<number, string>();
  let url: string | null = `${root}/api/v2/help_center/categories.json?per_page=100`;
  while (url) {
    const page: ZendeskCategoriesPage = await fetchJson(url, opts);
    for (const c of page.categories) {
      out.set(c.id, c.name);
    }
    url = page.next_page;
  }
  return out;
}
