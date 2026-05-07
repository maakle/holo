/**
 * Mintlify API helpers — all built on raw fetch (no Authorization header,
 * no rate limiter — the framework's HTTP client could do this too but
 * we'd be threading a lot of state through ctx.api just to skip the
 * auth path. Direct fetch is clearer and these endpoints are public.)
 *
 * Two surfaces:
 *   - `/llms.txt` — auto-published page index (markdown).
 *   - `<path>.md` — markdown twin of every page.
 *
 * Plus OpenAPI probing (`/openapi.json`, `/api-reference/openapi.json`, …).
 */
import type { LlmsIndex, LlmsIndexEntry } from './types';
import type { OpenApiDocument } from '@holo/chunker';

/** Strip trailing slashes for safe concatenation. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function fetchLlmsIndex(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LlmsIndex> {
  const res = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/llms.txt`, {
    headers: { Accept: 'text/markdown, text/plain, */*' },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Mintlify llms.txt returned ${res.status}`), {
      status: res.status,
    });
  }
  const text = await res.text();
  return parseLlmsIndex(text);
}

/**
 * Parse a Mintlify-flavoured llms.txt. Format (excerpts):
 *
 *     # Site title
 *
 *     > One-line description
 *
 *     ## Section name
 *
 *     - [Page title](/path/to/page): optional description
 *     - [Another](/other)
 *
 *     ## Another section
 *     ...
 *
 * We're permissive: ignore lines we don't recognize, accept absolute and
 * site-relative URLs, accept H1/H2/H3 section headers, accept bullets with
 * or without inline descriptions.
 */
export function parseLlmsIndex(text: string): LlmsIndex {
  const lines = text.split(/\r?\n/);
  let title = '';
  let description: string | undefined;
  let currentSection = '';
  const pages: LlmsIndexEntry[] = [];
  let titleSet = false;

  const linkRe = /^\s*[-*+]\s*\[([^\]]+)\]\(([^)]+)\)\s*(?::\s*(.*))?$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (!titleSet && line.startsWith('# ')) {
      title = line.slice(2).trim();
      titleSet = true;
      continue;
    }
    if (!description && line.startsWith('> ')) {
      description = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('### ')) {
      currentSection = line.slice(4).trim();
      continue;
    }

    const m = linkRe.exec(raw);
    if (!m) continue;
    const linkTitle = m[1]!.trim();
    const href = m[2]!.trim();
    const desc = m[3]?.trim();

    // Convert absolute URLs back to a path; skip cross-origin links (mintlify
    // sometimes links to external docs from the index).
    const path = toSitePath(href);
    if (!path) continue;

    pages.push({
      title: linkTitle,
      path,
      section: currentSection,
      ...(desc && desc.length > 0 ? { description: desc } : {}),
    });
  }

  return {
    title,
    ...(description ? { description } : {}),
    pages,
  };
}

function toSitePath(href: string): string | null {
  if (href.startsWith('/')) return href;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      const u = new URL(href);
      return u.pathname + (u.search ?? '');
    } catch {
      return null;
    }
  }
  // Relative paths without a leading `/` — assume site-relative.
  return `/${href}`;
}

/** Fetch one page's markdown via the `.md` twin Mintlify auto-publishes. */
export async function fetchPageMarkdown(
  baseUrl: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  // Strip a trailing slash on the path so `/foo/` and `/foo` collapse.
  const cleanPath = path.replace(/\/+$/, '');
  const url = `${normalizeBaseUrl(baseUrl)}${cleanPath}.md`;
  const res = await fetchImpl(url, {
    headers: { Accept: 'text/markdown, text/plain, */*' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw Object.assign(new Error(`Mintlify ${url} returned ${res.status}`), {
      status: res.status,
    });
  }
  return res.text();
}

/**
 * Conventional locations Mintlify customers tend to host their OpenAPI spec
 * at. We probe in order; the first 200 wins. Returning null means "this site
 * has no public OpenAPI spec" — the spec resource silently no-ops.
 */
const OPENAPI_PROBE_PATHS = [
  '/openapi.json',
  '/openapi.yaml',
  '/api-reference/openapi.json',
  '/api-reference/openapi.yaml',
  '/_mintlify/openapi.json',
];

export async function probeOpenApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; spec: OpenApiDocument } | null> {
  for (const p of OPENAPI_PROBE_PATHS) {
    const url = `${normalizeBaseUrl(baseUrl)}${p}`;
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json, application/yaml, */*' } });
      if (!res.ok) continue;
      const text = await res.text();
      // Only parse JSON spec for now; YAML support is straightforward to add
      // later if customers need it (would pull in a YAML parser dependency).
      if (p.endsWith('.json')) {
        try {
          const spec = JSON.parse(text) as OpenApiDocument;
          if (spec && (spec.openapi || spec.paths)) return { url, spec };
        } catch {
          /* not JSON — skip */
        }
      }
    } catch {
      /* network or DNS error — try next path */
    }
  }
  return null;
}
