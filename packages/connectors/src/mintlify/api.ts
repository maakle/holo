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
  return parseLlmsIndex(text, baseUrl);
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
 *
 * `baseUrl` is used to filter cross-origin links — Mintlify sites often
 * include changelog/status/community links to external hosts. Without
 * this filter we'd fetch `<baseUrl><externalPath>.md` and 404 every one
 * (or hit a TLS handshake failure on the external host's CDN).
 */
export function parseLlmsIndex(text: string, baseUrl?: string): LlmsIndex {
  const baseHost = baseUrl ? safeHost(baseUrl) : null;
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

    const path = toSitePath(href, baseHost);
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

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function toSitePath(href: string, baseHost: string | null): string | null {
  let path: string;
  if (href.startsWith('/')) {
    path = href;
  } else if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      const u = new URL(href);
      // Drop cross-origin links — they belong to other hosts (changelog,
      // status pages, community forums) and aren't part of the docs site.
      // Fetching them as `<baseUrl><externalPath>.md` 404s at best and
      // triggers a TLS handshake failure at worst. When baseHost is null
      // (legacy callers without baseUrl), preserve the old permissive
      // behavior so existing tests still pass.
      if (baseHost && u.host !== baseHost) return null;
      path = u.pathname + (u.search ?? '');
    } catch {
      return null;
    }
  } else {
    // Relative paths without a leading `/` — assume site-relative.
    path = `/${href}`;
  }
  // Some Mintlify sites (e.g. docs.kombo.dev) ship llms.txt with the `.md`
  // suffix already in the href. Strip it so the path is the canonical
  // page URL — `fetchPageMarkdown` re-appends `.md` to hit the markdown
  // twin, and chunks/cursors key off the clean path.
  if (path.endsWith('.md')) path = path.slice(0, -3);
  return path;
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
