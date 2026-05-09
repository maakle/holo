/**
 * Thin fetch-based GitLab REST API client.
 *
 * GitLab uses REST v4 with cursor-based "keyset" pagination on most
 * collection endpoints. We surface the next-page URL via the `Link`
 * header (rel="next") rather than reconstructing it, since GitLab signs
 * the keyset cursor inside the URL and reconstructing is error-prone.
 *
 * Rate-limit handling lives in the framework's HttpClient when callers
 * route through `ctx.api`. This module is used in two places:
 *   - The OAuth callback (one-shot identity probe), where we use a raw
 *     fetch wrapped here for symmetry with how GitHub does it.
 *   - The sync engines, which prefer to call us directly with the
 *     installation token rather than going through `ctx.api` — same
 *     reason as GitHub: the legacy callback shape predates the framework
 *     HttpClient and we kept it consistent.
 */
import { holoError, ErrorCode } from '@holo/errors';

const GITLAB_API = 'https://gitlab.com/api/v4';
const PER_PAGE = 100;
const MAX_RETRIES = 3;
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
// 5 minute cap mirrors the GitHub client; longer waits get reaped by
// BullMQ's stall detector and waste a worker slot.
const MAX_RATE_LIMIT_WAIT_MS = 5 * 60 * 1000;

export interface GitlabUser {
  id: number;
  username: string;
  name: string;
}

export interface GitlabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string | null;
  last_activity_at: string;
}

export interface GitlabMergeRequest {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  updated_at: string;
  merged_at: string | null;
  web_url: string;
  author: { username: string };
}

export interface GitlabIssue {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  updated_at: string;
  web_url: string;
  author: { username: string };
}

export interface GitlabNote {
  id: number;
  body: string;
  author: { username: string };
  system: boolean;
}

export interface GitlabRepoTreeEntry {
  id: string;
  name: string;
  type: 'blob' | 'tree';
  path: string;
}

export interface GitlabBranch {
  name: string;
  commit: { id: string };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = 500 * 2 ** attempt;
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

function computeRateLimitWaitMs(headers: Headers): number | null {
  const retryAfter = headers.get('Retry-After') ?? headers.get('retry-after');
  if (retryAfter) {
    const secs = parseInt(retryAfter, 10);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000 + 1000;
  }
  // GitLab sets RateLimit-Reset (epoch seconds) and RateLimit-Remaining.
  // https://docs.gitlab.com/ee/administration/settings/user_and_ip_rate_limits.html
  const remaining =
    headers.get('RateLimit-Remaining') ?? headers.get('ratelimit-remaining');
  const reset = headers.get('RateLimit-Reset') ?? headers.get('ratelimit-reset');
  if (remaining === '0' && reset) {
    const resetUnix = parseInt(reset, 10);
    if (Number.isFinite(resetUnix)) {
      const ms = resetUnix * 1000 - Date.now() + 1000;
      return Math.max(ms, 0);
    }
  }
  return null;
}

/**
 * Parse the Link header for `rel="next"`. GitLab returns absolute URLs
 * already pointing at the next keyset page; we just hand them back to
 * `fetch` verbatim.
 */
function nextLink(headers: Headers): string | null {
  const link = headers.get('Link') ?? headers.get('link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m && m[1]) return m[1];
  }
  return null;
}

interface PageResult<T> {
  items: T[];
  nextUrl: string | null;
}

async function glFetch(
  token: string,
  url: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    lastStatus = res.status;

    if (res.status === 401) {
      throw Object.assign(new Error('GitLab 401'), { status: 401 });
    }
    if (res.status === 403 || res.status === 429) {
      const waitMs = computeRateLimitWaitMs(res.headers);
      if (waitMs !== null && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
        await sleep(waitMs);
        attempt -= 1;
        continue;
      }
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem:
          waitMs !== null
            ? `GitLab rate-limited this token; reset in ~${Math.ceil(waitMs / 60000)}m.`
            : 'GitLab returned 403 (rate limit or forbidden)',
        fix:
          waitMs !== null
            ? 'The 6h scheduler will retry automatically when the window resets. No action needed.'
            : 'Verify the OAuth grant still has read_api + read_repository scopes.',
      });
    }
    if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt));
      continue;
    }
    return res;
  }
  throw holoError({
    code: ErrorCode.HOLO_FETCH_FAILED,
    problem: `GitLab API ${lastStatus} ${url} after ${MAX_RETRIES + 1} attempts`,
    fix: 'GitLab returned a transient error repeatedly. Retry the sync later.',
  });
}

async function getJson<T>(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  params?: Record<string, string>,
): Promise<T | null> {
  const url = new URL(`${GITLAB_API}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await glFetch(token, url.toString(), fetchImpl);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `GitLab API ${res.status} ${path}`,
      fix: 'Check the request parameters and token permissions.',
    });
  }
  return (await res.json()) as T;
}

async function getPage<T>(
  token: string,
  url: string,
  fetchImpl: typeof fetch,
): Promise<PageResult<T>> {
  const res = await glFetch(token, url, fetchImpl);
  if (!res.ok) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `GitLab API ${res.status} ${url}`,
      fix: 'Check token permissions and project visibility.',
    });
  }
  const items = ((await res.json()) ?? []) as T[];
  return { items, nextUrl: nextLink(res.headers) };
}

export interface GitlabApiClient {
  getCurrentUser(): Promise<GitlabUser>;
  listAccessibleProjects(): Promise<GitlabProject[]>;
  getProject(projectId: number): Promise<GitlabProject | null>;
  listMergeRequests(
    projectId: number,
    opts?: { updatedAfter?: string },
  ): Promise<GitlabMergeRequest[]>;
  listMergeRequestNotes(projectId: number, mrIid: number): Promise<GitlabNote[]>;
  listIssues(
    projectId: number,
    opts?: { updatedAfter?: string },
  ): Promise<GitlabIssue[]>;
  listIssueNotes(projectId: number, issueIid: number): Promise<GitlabNote[]>;
  getBranch(projectId: number, branch: string): Promise<GitlabBranch | null>;
  listRepositoryTree(
    projectId: number,
    ref: string,
  ): Promise<GitlabRepoTreeEntry[]>;
  getFileRaw(
    projectId: number,
    filePath: string,
    ref: string,
  ): Promise<string | null>;
}

export function createGitlabApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): GitlabApiClient {
  async function paginateAll<T>(initialPath: string, params?: Record<string, string>): Promise<T[]> {
    const url = new URL(`${GITLAB_API}${initialPath}`);
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('pagination', 'keyset');
    url.searchParams.set('order_by', 'id');
    url.searchParams.set('sort', 'asc');
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const out: T[] = [];
    let next: string | null = url.toString();
    let safety = 0;
    while (next && safety < 200) {
      safety += 1;
      const page: PageResult<T> = await getPage<T>(token, next, fetchImpl);
      out.push(...page.items);
      next = page.nextUrl;
    }
    return out;
  }

  return {
    async getCurrentUser() {
      const u = await getJson<GitlabUser>(token, '/user', fetchImpl);
      if (!u) {
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: 'GitLab /user returned 404',
          fix: 'Re-connect GitLab; the access token may have been revoked.',
        });
      }
      return u;
    },
    listAccessibleProjects() {
      // membership=true → only projects the token's user is a member of.
      // min_access_level=20 (Reporter) keeps out projects the token can
      // see but cannot meaningfully read code from.
      return paginateAll<GitlabProject>('/projects', {
        membership: 'true',
        min_access_level: '20',
        simple: 'false',
        archived: 'false',
      });
    },
    async getProject(projectId) {
      return getJson<GitlabProject>(token, `/projects/${projectId}`, fetchImpl);
    },
    async listMergeRequests(projectId, opts = {}) {
      const params: Record<string, string> = {
        state: 'all',
        order_by: 'updated_at',
        sort: 'desc',
        per_page: String(PER_PAGE),
      };
      if (opts.updatedAfter) params['updated_after'] = opts.updatedAfter;
      // updated_at sort doesn't support keyset; fall back to offset pagination.
      const out: GitlabMergeRequest[] = [];
      let page = 1;
      while (page <= 50) {
        params['page'] = String(page);
        const url = new URL(`${GITLAB_API}/projects/${projectId}/merge_requests`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const result = await getPage<GitlabMergeRequest>(token, url.toString(), fetchImpl);
        out.push(...result.items);
        if (result.items.length < PER_PAGE) break;
        page += 1;
      }
      return out;
    },
    async listMergeRequestNotes(projectId, mrIid) {
      const url = new URL(
        `${GITLAB_API}/projects/${projectId}/merge_requests/${mrIid}/notes`,
      );
      url.searchParams.set('per_page', String(PER_PAGE));
      url.searchParams.set('sort', 'asc');
      // Notes for a single MR are typically <100; the offset cap handles
      // outliers without opening the door to runaway loops.
      const out: GitlabNote[] = [];
      let next: string | null = url.toString();
      let safety = 0;
      while (next && safety < 20) {
        safety += 1;
        const result: PageResult<GitlabNote> = await getPage<GitlabNote>(token, next, fetchImpl);
        out.push(...result.items);
        next = result.nextUrl;
      }
      return out;
    },
    async listIssues(projectId, opts = {}) {
      const params: Record<string, string> = {
        state: 'all',
        order_by: 'updated_at',
        sort: 'desc',
        per_page: String(PER_PAGE),
        scope: 'all',
      };
      if (opts.updatedAfter) params['updated_after'] = opts.updatedAfter;
      const out: GitlabIssue[] = [];
      let page = 1;
      while (page <= 50) {
        params['page'] = String(page);
        const url = new URL(`${GITLAB_API}/projects/${projectId}/issues`);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        const result = await getPage<GitlabIssue>(token, url.toString(), fetchImpl);
        out.push(...result.items);
        if (result.items.length < PER_PAGE) break;
        page += 1;
      }
      return out;
    },
    async listIssueNotes(projectId, issueIid) {
      const url = new URL(
        `${GITLAB_API}/projects/${projectId}/issues/${issueIid}/notes`,
      );
      url.searchParams.set('per_page', String(PER_PAGE));
      url.searchParams.set('sort', 'asc');
      const out: GitlabNote[] = [];
      let next: string | null = url.toString();
      let safety = 0;
      while (next && safety < 20) {
        safety += 1;
        const result: PageResult<GitlabNote> = await getPage<GitlabNote>(token, next, fetchImpl);
        out.push(...result.items);
        next = result.nextUrl;
      }
      return out;
    },
    async getBranch(projectId, branch) {
      // Path-encode the branch name; GitLab requires URL-encoded refs
      // (slashes in branch names — e.g. `feature/foo` — must be %2F).
      return getJson<GitlabBranch>(
        token,
        `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`,
        fetchImpl,
      );
    },
    async listRepositoryTree(projectId, ref) {
      const out: GitlabRepoTreeEntry[] = [];
      let page = 1;
      while (page <= 100) {
        const url = new URL(`${GITLAB_API}/projects/${projectId}/repository/tree`);
        url.searchParams.set('ref', ref);
        url.searchParams.set('recursive', 'true');
        url.searchParams.set('per_page', String(PER_PAGE));
        url.searchParams.set('page', String(page));
        const res = await glFetch(token, url.toString(), fetchImpl);
        if (res.status === 404) return [];
        if (!res.ok) {
          throw holoError({
            code: ErrorCode.HOLO_FETCH_FAILED,
            problem: `GitLab repository/tree returned ${res.status}`,
            fix: 'Confirm the project has commits on the default branch.',
          });
        }
        const items = ((await res.json()) ?? []) as GitlabRepoTreeEntry[];
        out.push(...items);
        if (items.length < PER_PAGE) break;
        page += 1;
      }
      return out;
    },
    async getFileRaw(projectId, filePath, ref) {
      const url = new URL(
        `${GITLAB_API}/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw`,
      );
      url.searchParams.set('ref', ref);
      const res = await glFetch(token, url.toString(), fetchImpl);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: `GitLab files/raw returned ${res.status} for ${filePath}`,
          fix: 'Verify the file exists on the ref and the token has read_repository.',
        });
      }
      return await res.text();
    },
  };
}
