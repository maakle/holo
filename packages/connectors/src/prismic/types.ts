/**
 * Prismic is consumed through three endpoints on the CDN:
 *
 *   1. `GET https://<repo>.cdn.prismic.io/api/v2`
 *      Repository metadata: the master ref (opaque ID that changes on every
 *      publish), available languages, and the list of custom-type slugs.
 *
 *   2. `GET https://<repo>.cdn.prismic.io/api/v2/documents/search?ref=<ref>&page=N`
 *      Paginated document list. Each document has a `type`, `uid`, `lang`,
 *      `last_publication_date`, and a `data` blob containing the slices /
 *      rich-text fields the editor populated.
 *
 *   3. Same endpoint with `q=[[date.after(document.last_publication_date,...)]]`
 *      for incremental fetches between syncs.
 *
 * All three accept an optional `Authorization: Token <PAT>` header for
 * repositories that have enabled Repository Privacy. Public repos (the
 * common case — marketing sites, FAQs) don't require any auth.
 */

/** Repo descriptor returned by `GET /api/v2`. We only consume a subset. */
export interface PrismicRepository {
  /** Current master ref ID — opaque string that changes on every publish. */
  refs: Array<{
    id: string;
    ref: string;
    label: string;
    isMasterRef: boolean;
  }>;
  /** Custom-type slugs the repo defines (`faq`, `page`, `blog_post`, ...). */
  types: Record<string, string>;
  /** Locale codes the repo publishes in (e.g. `de-de`, `en-us`). */
  languages: Array<{ id: string; name: string }>;
}

/**
 * One document as returned by the search endpoint. Prismic ships a lot more
 * fields (alternate_languages, tags, slugs[], …) but we only key on these.
 * `data` stays untyped because its shape is custom-type-specific.
 */
export interface PrismicDocument {
  id: string;
  uid: string | null;
  type: string;
  lang: string;
  href: string;
  /** ISO8601 timestamp; used as the incremental watermark. */
  last_publication_date: string;
  first_publication_date: string;
  tags: string[];
  /** Slice zones + field values keyed by custom-type field id. */
  data: Record<string, unknown>;
}

/** Paginated search response. */
export interface PrismicSearchResponse {
  page: number;
  results_per_page: number;
  results_size: number;
  total_results_size: number;
  total_pages: number;
  next_page: string | null;
  prev_page: string | null;
  results: PrismicDocument[];
}
