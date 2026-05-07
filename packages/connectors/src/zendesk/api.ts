/**
 * Zendesk Help Center API helpers — built on raw fetch, no Authorization
 * header (public help centers don't need one). Two listing strategies:
 *
 *   1. Public articles listing — `/api/v2/help_center/articles.json
 *      ?sort_by=updated_at&sort_order=desc`. Zendesk's `/incremental/...`
 *      endpoints require admin auth even on publicly-readable help centers,
 *      so we walk the public listing newest-first and stop once we cross
 *      the caller's `startTime`. Same incremental behaviour, no token.
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
 * Iterate the public articles listing newest-first, yielding pages until
 * either Zendesk runs out of `next_page` or we cross `startTime` (Unix
 * seconds). Pass 0 for a full sweep. Articles older than `startTime` are
 * filtered out of the final yielded page so the caller sees a clean cutoff.
 */
export async function* iterateArticlesIncremental(
  baseUrl: string,
  startTime: number,
  opts: FetchJsonOpts = {},
): AsyncGenerator<ZendeskArticlesPage> {
  const root = normalizeBaseUrl(baseUrl);
  let url: string | null =
    `${root}/api/v2/help_center/articles.json?sort_by=updated_at&sort_order=desc&per_page=100`;
  while (url) {
    const page: ZendeskArticlesPage = await fetchJson(url, opts);
    if (startTime > 0) {
      const fresh = page.articles.filter((a) => {
        const ts = Math.floor(new Date(a.updated_at).getTime() / 1000);
        return ts >= startTime;
      });
      const reachedCursor = fresh.length < page.articles.length;
      yield { ...page, articles: fresh, next_page: reachedCursor ? null : page.next_page };
      if (reachedCursor) return;
    } else {
      yield page;
    }
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
