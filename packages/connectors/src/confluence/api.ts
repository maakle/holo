import { ErrorCode, holoError } from '@holo/errors';
import type { HttpClient } from '@holo/connector-framework';
import type {
  ConfluenceContentSearchResponse,
  ConfluenceCurrentUser,
  ConfluenceSpacesPage,
  ConfluenceTenantInfo,
} from './types';

const PAGE_EXPAND = [
  'body.atlas_doc_format',
  'space',
  'version',
  'history',
  'ancestors',
  'children.comment.body.atlas_doc_format',
  'children.comment.version',
  'children.comment.history',
  'children.comment.extensions.location',
].join(',');

/**
 * Build the CQL clause for the pages resource. Anchors first-sync at the
 * unix epoch so the `lastModified >=` filter always has a value, and orders
 * ascending so the cursor watermark advances monotonically across pages.
 *
 * CQL only accepts `yyyy-MM-dd` or `yyyy-MM-dd HH:mm` for date literals —
 * ISO 8601 strings with `T`, milliseconds, or `Z` fail the parser. We
 * truncate to minute precision in UTC; minute-level overlap is safe because
 * the filter is `>=` and downstream chunking dedupes by version.
 */
export function formatCqlTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Invalid timestamp for CQL: ${iso}`,
      fix: 'Pass an ISO 8601 string or undefined.',
    });
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function buildPagesCql(since: string | undefined): string {
  const ts = since ? formatCqlTimestamp(since) : '1970-01-01 00:00';
  return `(type = "page" OR type = "blogpost") AND lastModified >= "${ts}" ORDER BY lastModified ASC`;
}

/**
 * GET /wiki/rest/api/content/search — CQL-driven content listing with
 * start/limit pagination. We expand body (ADF), space, version, ancestors,
 * and top-level inline + footer comments so a single fetch produces all the
 * chunks for one page.
 */
export async function searchContent(
  api: HttpClient,
  input: { cql: string; start: number; limit?: number },
): Promise<ConfluenceContentSearchResponse> {
  return api.get<ConfluenceContentSearchResponse>('/wiki/rest/api/content/search', {
    query: {
      cql: input.cql,
      expand: PAGE_EXPAND,
      start: input.start,
      limit: input.limit ?? 25,
    },
  });
}

/**
 * GET /wiki/rest/api/space — list global spaces with description expanded.
 * Offset pagination via start/limit.
 */
export async function searchSpaces(
  api: HttpClient,
  input: { start: number; limit?: number },
): Promise<ConfluenceSpacesPage> {
  return api.get<ConfluenceSpacesPage>('/wiki/rest/api/space', {
    query: {
      type: 'global',
      expand: 'description.plain',
      start: input.start,
      limit: input.limit ?? 50,
    },
  });
}

export async function fetchCurrentUser(api: HttpClient): Promise<ConfluenceCurrentUser> {
  return api.get<ConfluenceCurrentUser>('/wiki/rest/api/user/current');
}

/**
 * GET /wiki/_edge/tenant_info — returns the Atlassian cloudId for the
 * tenant. Used by the connect route to populate sources.externalId so
 * downstream rows align with the parent Atlassian site.
 */
export async function fetchTenantInfo(api: HttpClient): Promise<ConfluenceTenantInfo> {
  return api.get<ConfluenceTenantInfo>('/wiki/_edge/tenant_info');
}

/**
 * Normalize a user-supplied site URL to `https://<host>` with no trailing
 * slash and no path. Same shape as Jira's normalizer — Confluence lives at
 * `<host>/wiki` on the same Atlassian Cloud tenant.
 *
 * Accepts:
 *   - acme.atlassian.net
 *   - https://acme.atlassian.net/
 *   - https://acme.atlassian.net/wiki/spaces/ENG/...
 * Throws HOLO_INVALID_INPUT for unparseable hosts or any non-`.atlassian.net`
 * host (SSRF guard — see Jira normalizer rationale).
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${raw}" is not a valid site URL`,
      fix: 'Use the form https://yourcompany.atlassian.net (paste from your browser address bar on any Confluence page).',
    });
  }
  const host = parsed.host.toLowerCase();
  if (!host.endsWith('.atlassian.net')) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${raw}" is not an Atlassian Cloud site URL`,
      fix: 'Use the form https://yourcompany.atlassian.net. Confluence Server / Data Center are not supported.',
    });
  }
  return `https://${host}`;
}

/**
 * v1 stores ADF as a JSON *string* in body.atlas_doc_format.value. This
 * helper parses it into an AdfNode-shaped unknown so callers can hand it
 * straight to adfToPlainText. Returns `null` on parse failure (rare; we
 * fall back to an empty body in chunking).
 */
export function parseAtlasDocFormat(value: string | undefined): unknown {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
