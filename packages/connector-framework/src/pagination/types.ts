import type { HttpClient, RequestOptions } from '../http/types';

export interface CursorPaginationConfig<TPage, TItem> {
  /** Query param name for the cursor. Defaults to 'cursor'. */
  cursorParam?: string;
  /** Extract items from a page. */
  items: (page: TPage) => ReadonlyArray<TItem>;
  /** Extract the next cursor value, or null/undefined to stop. */
  nextCursor: (page: TPage) => string | null | undefined;
  /** Initial query params (e.g. updated-since). */
  baseQuery?: RequestOptions['query'];
}

export interface PagePaginationConfig<TPage, TItem> {
  /** Query param name for the page number. Defaults to 'page'. */
  pageParam?: string;
  /** Page size param + value. */
  size?: { param: string; value: number };
  /** Starting page (default 1). */
  startPage?: number;
  /** Maximum pages to fetch (safety bound). Defaults to 1000. */
  maxPages?: number;
  items: (page: TPage) => ReadonlyArray<TItem>;
  /** Return false to stop. Defaults to "stop when items() is empty". */
  hasMore?: (page: TPage) => boolean;
  baseQuery?: RequestOptions['query'];
}

export interface LinkHeaderPaginationConfig<TPage, TItem> {
  items: (page: TPage) => ReadonlyArray<TItem>;
  /** Maximum pages to fetch (safety bound). Defaults to 1000. */
  maxPages?: number;
  baseQuery?: RequestOptions['query'];
}

export interface Paginator {
  cursor<TPage, TItem>(
    path: string,
    config: CursorPaginationConfig<TPage, TItem>,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<ReadonlyArray<TItem>>;

  page<TPage, TItem>(
    path: string,
    config: PagePaginationConfig<TPage, TItem>,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<ReadonlyArray<TItem>>;

  linkHeader<TPage, TItem>(
    path: string,
    config: LinkHeaderPaginationConfig<TPage, TItem>,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<ReadonlyArray<TItem>>;
}

export interface BuildPaginatorInput {
  client: HttpClient;
  /**
   * Hook to capture the raw `Response` for link-header pagination. The
   * default HttpClient parses + discards the response object, so callers
   * that need headers must use a request override. Provided as a separate
   * `requestWithResponse` callback to avoid bloating the HttpClient
   * interface for the common case.
   */
  requestWithResponse?: <T>(
    method: string,
    path: string,
    opts?: RequestOptions,
  ) => Promise<{ json: T; headers: Headers }>;
}
