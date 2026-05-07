import { ErrorCode, holoError } from '@holo/errors';
import type {
  BuildPaginatorInput,
  CursorPaginationConfig,
  LinkHeaderPaginationConfig,
  PagePaginationConfig,
  Paginator,
} from './types';

/** Parse `Link: <url>; rel="next", <url>; rel="prev"` header into a map. */
export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m && m[1] && m[2]) out[m[2]] = m[1];
  }
  return out;
}

export function buildPaginator(input: BuildPaginatorInput): Paginator {
  const { client } = input;

  return {
    async *cursor<TPage, TItem>(
      path: string,
      config: CursorPaginationConfig<TPage, TItem>,
      opts?: { signal?: AbortSignal },
    ): AsyncIterable<ReadonlyArray<TItem>> {
      const cursorParam = config.cursorParam ?? 'cursor';
      let cursor: string | null | undefined;
      while (true) {
        opts?.signal?.throwIfAborted();
        const query = { ...(config.baseQuery ?? {}) };
        if (cursor) query[cursorParam] = cursor;
        const page = await client.get<TPage>(path, { query, signal: opts?.signal });
        yield config.items(page);
        const next = config.nextCursor(page);
        if (!next) return;
        cursor = next;
      }
    },

    async *page<TPage, TItem>(
      path: string,
      config: PagePaginationConfig<TPage, TItem>,
      opts?: { signal?: AbortSignal },
    ): AsyncIterable<ReadonlyArray<TItem>> {
      const pageParam = config.pageParam ?? 'page';
      const startPage = config.startPage ?? 1;
      const maxPages = config.maxPages ?? 1000;
      let pageNum = startPage;
      while (pageNum < startPage + maxPages) {
        opts?.signal?.throwIfAborted();
        const query: Record<string, string | number | undefined> = {
          ...(config.baseQuery ?? {}),
        };
        query[pageParam] = pageNum;
        if (config.size) query[config.size.param] = config.size.value;
        const page = await client.get<TPage>(path, { query, signal: opts?.signal });
        const items = config.items(page);
        yield items;
        const more = config.hasMore ? config.hasMore(page) : items.length > 0;
        if (!more) return;
        pageNum += 1;
      }
    },

    async *linkHeader<TPage, TItem>(
      path: string,
      config: LinkHeaderPaginationConfig<TPage, TItem>,
      opts?: { signal?: AbortSignal },
    ): AsyncIterable<ReadonlyArray<TItem>> {
      if (!input.requestWithResponse) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem:
            'linkHeader pagination requires `requestWithResponse` on buildPaginator',
          fix: 'Pass a requestWithResponse callback when constructing the paginator.',
        });
      }
      const maxPages = config.maxPages ?? 1000;
      let url: string | null = path;
      let baseQuery: Record<string, string | number | undefined> | undefined = config.baseQuery;
      let pageCount = 0;
      while (url && pageCount < maxPages) {
        opts?.signal?.throwIfAborted();
        const { json, headers } = await input.requestWithResponse<TPage>('GET', url, {
          query: pageCount === 0 ? baseQuery : undefined,
          signal: opts?.signal,
        });
        yield config.items(json);
        const links = parseLinkHeader(headers.get('Link'));
        url = links['next'] ?? null;
        baseQuery = undefined; // subsequent URLs are absolute
        pageCount += 1;
      }
    },
  };
}
