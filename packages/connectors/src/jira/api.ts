import { ErrorCode, holoError } from '@holo/errors';
import type { HttpClient } from '@holo/connector-framework';
import type {
  JiraIssueSearchResponse,
  JiraMyself,
  JiraProjectSearchResponse,
  JiraServerInfo,
} from './types';

const PROJECT_FIELDS = [
  'summary',
  'description',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'project',
  'labels',
  'created',
  'updated',
  'comment',
] as const;

/**
 * Build the JQL clause for the issues resource. Anchors first-sync at the
 * unix epoch (mirrors Linear) so the `updated >= "..."` filter never has a
 * null variable. Resulting clause includes `ORDER BY updated ASC` so the
 * cursor watermark advances monotonically across pages.
 */
export function buildIssuesJql(since: string | undefined): string {
  const ts = since ?? '1970-01-01 00:00';
  return `updated >= "${ts}" ORDER BY updated ASC`;
}

/**
 * POST /rest/api/3/search/jql — Atlassian's v3 successor to the deprecated
 * `/search` endpoint. Token-based pagination via `nextPageToken`.
 */
export async function searchIssues(
  api: HttpClient,
  input: { jql: string; nextPageToken?: string; pageSize?: number },
): Promise<JiraIssueSearchResponse> {
  return api.post<JiraIssueSearchResponse>('/rest/api/3/search/jql', {
    jql: input.jql,
    nextPageToken: input.nextPageToken,
    maxResults: input.pageSize ?? 50,
    fields: PROJECT_FIELDS,
    fieldsByKeys: false,
  });
}

/**
 * GET /rest/api/3/project/search — offset-based pagination via startAt.
 */
export async function searchProjects(
  api: HttpClient,
  input: { startAt: number; pageSize?: number },
): Promise<JiraProjectSearchResponse> {
  return api.get<JiraProjectSearchResponse>('/rest/api/3/project/search', {
    query: {
      startAt: input.startAt,
      maxResults: input.pageSize ?? 50,
      expand: 'description,lead',
    },
  });
}

export async function fetchMyself(api: HttpClient): Promise<JiraMyself> {
  return api.get<JiraMyself>('/rest/api/3/myself');
}

export async function fetchServerInfo(api: HttpClient): Promise<JiraServerInfo> {
  return api.get<JiraServerInfo>('/rest/api/3/serverInfo');
}

/**
 * Normalize a user-supplied site URL to `https://<host>` with no trailing
 * slash and no path. Accepts:
 *   - acme.atlassian.net
 *   - http://acme.atlassian.net
 *   - https://acme.atlassian.net/
 *   - https://acme.atlassian.net/jira/your-work
 * Throws HOLO_INVALID_INPUT if the host isn't a parseable URL.
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
      fix: 'Use the form https://yourcompany.atlassian.net (paste from your browser address bar on any Jira page).',
    });
  }
  const host = parsed.host.toLowerCase();
  // Restrict to Atlassian Cloud — the connect route probes this host before
  // saving, so accepting arbitrary URLs would let any signed-in user fan
  // outbound HTTPS at internal services. Jira Server / DC are out of scope.
  if (!host.endsWith('.atlassian.net')) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${raw}" is not an Atlassian Cloud site URL`,
      fix: 'Use the form https://yourcompany.atlassian.net. Jira Server / Data Center are not supported.',
    });
  }
  return `https://${host}`;
}
