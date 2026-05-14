/**
 * Prismic API helpers — raw fetch, no SDK. The endpoints are simple JSON
 * over HTTPS; pulling in `@prismicio/client` would buy us typed helpers but
 * lock the version of the wire format we accept. Direct fetch is the same
 * pattern used by the Mintlify and Zendesk connectors.
 */
import { ErrorCode, holoError } from '@holo/errors';
import type {
  PrismicDocument,
  PrismicRepository,
  PrismicSearchResponse,
} from './types';

/** Prismic repo names are lowercase alphanumeric + hyphens. */
export const PRISMIC_REPO_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidRepoName(name: string): boolean {
  return PRISMIC_REPO_RE.test(name);
}

/**
 * Accept either `beglaubigt` or `https://beglaubigt.cdn.prismic.io/api/v2`
 * and return the canonical repo slug. Useful for the connect route where
 * users paste whatever URL they have handy.
 */
export function parseRepoInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try as a URL first; fall back to treating it as a bare slug.
  try {
    const u = new URL(trimmed);
    const host = u.hostname;
    // Accept *.prismic.io and *.cdn.prismic.io.
    const m = /^([a-z0-9-]+)(?:\.cdn)?\.prismic\.io$/.exec(host);
    if (m) return m[1] ?? null;
    return null;
  } catch {
    return isValidRepoName(trimmed) ? trimmed : null;
  }
}

export function repoApiBase(repo: string): string {
  return `https://${repo}.cdn.prismic.io/api/v2`;
}

function authHeaders(accessToken: string | undefined): Record<string, string> {
  const base: Record<string, string> = { Accept: 'application/json' };
  if (accessToken && accessToken.length > 0) {
    base['Authorization'] = `Token ${accessToken}`;
  }
  return base;
}

/**
 * Fetch repo metadata. Returns the parsed envelope; throws with a `.status`
 * on non-2xx so callers (the connect route) can distinguish "not found" from
 * "auth required" from "everything's fine".
 */
export async function fetchRepository(
  repo: string,
  accessToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PrismicRepository> {
  const res = await fetchImpl(repoApiBase(repo), {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw Object.assign(
      new Error(`Prismic ${repoApiBase(repo)} returned ${res.status}`),
      { status: res.status },
    );
  }
  return (await res.json()) as PrismicRepository;
}

export function getMasterRef(repo: PrismicRepository): string {
  const master = repo.refs.find((r) => r.isMasterRef) ?? repo.refs[0];
  if (!master) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: 'Prismic /api/v2 response did not include any refs',
      fix: 'Confirm the repository slug points at a real Prismic repository.',
    });
  }
  return master.ref;
}

/**
 * Page through `/documents/search`. Yields each document; callers decide what
 * to do with it (hash, chunk, upsert). Honours an optional `afterIso` filter
 * which translates to Prismic's predicate language to fetch only docs
 * published since the given timestamp — that's the incremental hook.
 *
 * `signal` is honoured between pages (Prismic doesn't expose a streaming API,
 * so per-document interruption isn't possible without aborting the in-flight
 * page request — fine for our cadence).
 */
export async function* iterateDocuments(
  repo: string,
  ref: string,
  opts: {
    accessToken?: string;
    afterIso?: string;
    pageSize?: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<PrismicDocument, void, void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pageSize = opts.pageSize ?? 100;
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    opts.signal?.throwIfAborted();
    const url = new URL(`${repoApiBase(repo)}/documents/search`);
    url.searchParams.set('ref', ref);
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('page', String(page));
    url.searchParams.set('orderings', '[document.last_publication_date desc]');
    if (opts.afterIso) {
      // Prismic's date.after only accepts `yyyy-MM-dd` or `yyyy-MM-dd'T'HH:mm:ssZ`
      // — fractional seconds (e.g. `.495Z` from Date.toISOString()) trigger a 400.
      const normalized = opts.afterIso.replace(/\.\d+Z$/, 'Z');
      url.searchParams.set(
        'q',
        `[[date.after(document.last_publication_date, "${normalized}")]]`,
      );
    }
    const res = await fetchImpl(url.toString(), {
      headers: authHeaders(opts.accessToken),
    });
    if (!res.ok) {
      throw Object.assign(new Error(`Prismic search ${url} returned ${res.status}`), {
        status: res.status,
      });
    }
    const body = (await res.json()) as PrismicSearchResponse;
    totalPages = body.total_pages;
    for (const doc of body.results) {
      yield doc;
    }
    page += 1;
  }
}

/**
 * Extract human-readable text from a Prismic document's `data` blob. Walks
 * the structure recursively because slices nest arbitrarily; Prismic doesn't
 * publish a canonical "render this to plain text" — we just visit every
 * leaf string and concatenate, with the slice / field id as a soft header so
 * the chunker preserves some structure.
 *
 * Specifically handles:
 *   - Rich-text fields: arrays of `{ type, text, spans }` blocks → join `text`.
 *   - Key-text / select / number / boolean: leaf string conversion.
 *   - Image fields: surface `alt` text only (URL goes in metadata, not body).
 *   - Link / content-relationship: drop (target lives elsewhere).
 *   - Slices (`slice_type` + `primary` + `items`): recurse into `primary` and
 *     each row of `items`, prefixed by the slice type.
 *   - Group fields (arrays of objects): recurse into each row.
 */
export function documentToMarkdown(doc: PrismicDocument): string {
  const parts: string[] = [];
  visitField(doc.data, parts, '');
  return parts.join('\n\n').trim();
}

function visitField(value: unknown, out: string[], prefix: string): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.trim().length === 0) return;
    out.push(prefix ? `${prefix}: ${value}` : value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(prefix ? `${prefix}: ${String(value)}` : String(value));
    return;
  }
  if (Array.isArray(value)) {
    // Rich-text blocks have a `type` discriminator and a `text` field.
    if (value.length > 0 && isRichTextBlock(value[0])) {
      const md = richTextToMarkdown(value as RichTextBlock[]);
      if (md.trim().length > 0) {
        out.push(prefix ? `${prefix}:\n${md}` : md);
      }
      return;
    }
    // Otherwise it's either a group field or a slice zone; recurse.
    for (const [i, item] of value.entries()) {
      visitField(item, out, prefix ? `${prefix}[${i}]` : `[${i}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Image field: surface alt text only.
    if (typeof obj['url'] === 'string' && ('alt' in obj || 'dimensions' in obj)) {
      const alt = typeof obj['alt'] === 'string' ? obj['alt'] : '';
      if (alt.trim().length > 0) out.push(prefix ? `${prefix} (image alt): ${alt}` : `(image) ${alt}`);
      return;
    }
    // Link / content-relationship: skipping — no human-readable content.
    if (
      typeof obj['link_type'] === 'string' &&
      ('url' in obj || 'id' in obj || 'slug' in obj)
    ) {
      return;
    }
    // Slice: `slice_type` + optional `primary` + optional `items[]`.
    if (typeof obj['slice_type'] === 'string') {
      const sliceType = obj['slice_type'] as string;
      const sliceLabel = typeof obj['slice_label'] === 'string'
        ? `${sliceType}:${obj['slice_label'] as string}`
        : sliceType;
      if (obj['primary'] && typeof obj['primary'] === 'object') {
        visitField(obj['primary'], out, sliceLabel);
      }
      if (Array.isArray(obj['items'])) {
        for (const [i, row] of (obj['items'] as unknown[]).entries()) {
          visitField(row, out, `${sliceLabel}.item[${i}]`);
        }
      }
      return;
    }
    // Plain object: recurse into each key.
    for (const [k, v] of Object.entries(obj)) {
      visitField(v, out, prefix ? `${prefix}.${k}` : k);
    }
  }
}

interface RichTextBlock {
  type: string;
  text?: string;
  spans?: unknown[];
}

function isRichTextBlock(v: unknown): v is RichTextBlock {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { type?: unknown }).type === 'string' &&
    'text' in (v as object)
  );
}

/**
 * Render Prismic rich-text blocks to markdown. Block types we recognise:
 * `heading1`..`heading6`, `paragraph`, `preformatted`, `list-item`,
 * `o-list-item`. Anything else falls through as a paragraph so we don't
 * silently drop text on future block types.
 */
export function richTextToMarkdown(blocks: RichTextBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const text = block.text ?? '';
    switch (block.type) {
      case 'heading1':
        lines.push(`# ${text}`);
        break;
      case 'heading2':
        lines.push(`## ${text}`);
        break;
      case 'heading3':
        lines.push(`### ${text}`);
        break;
      case 'heading4':
        lines.push(`#### ${text}`);
        break;
      case 'heading5':
        lines.push(`##### ${text}`);
        break;
      case 'heading6':
        lines.push(`###### ${text}`);
        break;
      case 'preformatted':
        lines.push('```');
        lines.push(text);
        lines.push('```');
        break;
      case 'list-item':
        lines.push(`- ${text}`);
        break;
      case 'o-list-item':
        lines.push(`1. ${text}`);
        break;
      case 'paragraph':
      default:
        lines.push(text);
        break;
    }
  }
  return lines.join('\n');
}
