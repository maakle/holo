// Thin fetch-based GitHub REST API client

export interface GithubRepo {
  full_name: string;
  default_branch: string;
  pushed_at: string;
}

export interface GithubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  updated_at: string;
  merged_at: string | null;
}

export interface GithubPrFile {
  filename: string;
  patch?: string;
  status: string;
}

export interface GithubPrReview {
  user: { login: string };
  body: string;
  state: string;
}

export interface GithubPrReviewComment {
  user: { login: string };
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  updated_at: string;
  pull_request?: { url: string };
}

export interface GithubIssueComment {
  user: { login: string };
  body: string;
}

export interface GithubTreeFile {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface GithubApiClient {
  getRepo(repoFullName: string): Promise<GithubRepo>;
  listPullRequests(
    repoFullName: string,
    opts?: { state?: string; page?: number; perPage?: number },
  ): Promise<{ items: GithubPullRequest[]; hasMore: boolean }>;
  getPrFiles(repoFullName: string, prNumber: number): Promise<GithubPrFile[]>;
  getPrReviews(repoFullName: string, prNumber: number): Promise<GithubPrReview[]>;
  getPrReviewComments(repoFullName: string, prNumber: number): Promise<GithubPrReviewComment[]>;
  listIssues(
    repoFullName: string,
    opts?: { page?: number; perPage?: number; since?: string },
  ): Promise<{ items: GithubIssue[]; hasMore: boolean }>;
  getIssueComments(repoFullName: string, issueNumber: number): Promise<GithubIssueComment[]>;
  getIssue(repoFullName: string, issueNumber: number): Promise<GithubIssue | null>;
  getTree(repoFullName: string, treeSha: string): Promise<GithubTreeFile[]>;
  getFileContent(repoFullName: string, filePath: string, ref?: string): Promise<string | null>;
  getRef(repoFullName: string, ref: string): Promise<{ sha: string }>;
}

import { holoError, ErrorCode } from '@holo/errors';

const GH_API = 'https://api.github.com';
const PER_PAGE = 100;

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MAX_RETRIES = 3;
// Cap rate-limit waits so a misconfigured reset header can't pin a job for
// hours. GitHub's primary rate limits reset on a rolling 1-hour window, so
// at any moment the reset can be up to 60 min away. We allow a small buffer
// past that to absorb clock skew between us and GitHub. BullMQ auto-renews
// the worker's job lock during sleep, so a long wait doesn't risk a stalled
// pickup — better than giving up and re-running the whole walk later.
const MAX_RATE_LIMIT_WAIT_MS = 65 * 60 * 1000;

async function ghFetch(
  token: string,
  path: string,
  fetchImpl: typeof fetch,
  params?: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${GH_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  let lastStatus = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset). Treat as transient.
      if (attempt === MAX_RETRIES) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }
    lastStatus = res.status;

    if (res.status === 401) {
      throw Object.assign(new Error('GitHub 401'), { status: 401 });
    }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      const waitMs = computeRateLimitWaitMs(res.headers);
      if (waitMs !== null && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
        await sleep(waitMs);
        // Retry without consuming a transient-retry slot; rate limits aren't
        // transient errors, they're cooperative throttling.
        attempt -= 1;
        continue;
      }
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem:
          waitMs !== null
            ? `GitHub rate-limited this installation; reset in ~${Math.ceil(waitMs / 60000)}m. ` +
              `This is GitHub throttling our App, not a code error.`
            : 'GitHub returned 403 (rate limit or forbidden)',
        fix:
          waitMs !== null
            ? 'The 6h scheduler will retry automatically when the window resets. No action needed.'
            : 'Verify the App installation has access and the installation token has the expected permissions.',
      });
    }
    if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `GitHub API ${res.status} ${path}`,
        fix: 'Check the request parameters and token permissions.',
      });
    }
    return res.json();
  }
  // Exhausted retries on transient status.
  throw holoError({
    code: ErrorCode.HOLO_FETCH_FAILED,
    problem: `GitHub API ${lastStatus} ${path} after ${MAX_RETRIES + 1} attempts`,
    fix: 'GitHub returned a transient error repeatedly. Retry the sync later.',
  });
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s with full jitter
  const base = 500 * 2 ** attempt;
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the number of milliseconds to wait before retrying a 403/429, or
 * `null` if we can't tell from the headers (in which case the caller should
 * throw rather than guess). Honors:
 * - `Retry-After` (secondary rate limit / abuse detection): seconds.
 * - `X-RateLimit-Remaining: 0` + `X-RateLimit-Reset`: unix timestamp.
 *
 * Always pads by 1s to avoid waking up exactly on the reset boundary.
 */
function computeRateLimitWaitMs(headers: Headers): number | null {
  const retryAfter = headers.get('Retry-After') ?? headers.get('retry-after');
  if (retryAfter) {
    const secs = parseInt(retryAfter, 10);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000 + 1000;
  }
  const remaining = headers.get('X-RateLimit-Remaining') ?? headers.get('x-ratelimit-remaining');
  const reset = headers.get('X-RateLimit-Reset') ?? headers.get('x-ratelimit-reset');
  if (remaining === '0' && reset) {
    const resetUnix = parseInt(reset, 10);
    if (Number.isFinite(resetUnix)) {
      const ms = resetUnix * 1000 - Date.now() + 1000;
      return Math.max(ms, 0);
    }
  }
  return null;
}

export function createGithubApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): GithubApiClient {
  const get = (path: string, params?: Record<string, string>) =>
    ghFetch(token, path, fetchImpl, params);

  return {
    async getRepo(repoFullName) {
      return (await get(`/repos/${repoFullName}`)) as GithubRepo;
    },

    async listPullRequests(repoFullName, opts = {}) {
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? PER_PAGE;
      const params: Record<string, string> = {
        state: opts.state ?? 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: String(perPage),
        page: String(page),
      };
      const items = ((await get(`/repos/${repoFullName}/pulls`, params)) ?? []) as GithubPullRequest[];
      return { items, hasMore: items.length === perPage };
    },

    async getPrFiles(repoFullName, prNumber) {
      const items = ((await get(`/repos/${repoFullName}/pulls/${prNumber}/files`, { per_page: '100' })) ?? []) as GithubPrFile[];
      return items;
    },

    async getPrReviews(repoFullName, prNumber) {
      const items = ((await get(`/repos/${repoFullName}/pulls/${prNumber}/reviews`, { per_page: '100' })) ?? []) as GithubPrReview[];
      return items;
    },

    async getPrReviewComments(repoFullName, prNumber) {
      const items = ((await get(`/repos/${repoFullName}/pulls/${prNumber}/comments`, { per_page: '100' })) ?? []) as GithubPrReviewComment[];
      return items;
    },

    async listIssues(repoFullName, opts = {}) {
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? PER_PAGE;
      const params: Record<string, string> = {
        state: 'all',
        per_page: String(perPage),
        page: String(page),
        filter: 'all',
      };
      if (opts.since) params['since'] = opts.since;
      const items = ((await get(`/repos/${repoFullName}/issues`, params)) ?? []) as GithubIssue[];
      return { items, hasMore: items.length === perPage };
    },

    async getIssueComments(repoFullName, issueNumber) {
      const items = ((await get(`/repos/${repoFullName}/issues/${issueNumber}/comments`, { per_page: '100' })) ?? []) as GithubIssueComment[];
      return items;
    },

    async getIssue(repoFullName, issueNumber) {
      return (await get(`/repos/${repoFullName}/issues/${issueNumber}`)) as GithubIssue | null;
    },

    async getTree(repoFullName, treeSha) {
      const res = (await get(`/repos/${repoFullName}/git/trees/${treeSha}`, { recursive: '1' })) as {
        tree: GithubTreeFile[];
      } | null;
      return res?.tree ?? [];
    },

    async getFileContent(repoFullName, filePath, ref) {
      const params: Record<string, string> = {};
      if (ref) params['ref'] = ref;
      const res = (await get(`/repos/${repoFullName}/contents/${filePath}`, params)) as {
        content: string;
        encoding: string;
      } | null;
      if (!res || res.encoding !== 'base64') return null;
      return Buffer.from(res.content.replace(/\n/g, ''), 'base64').toString('utf8');
    },

    async getRef(repoFullName, ref) {
      const res = (await get(`/repos/${repoFullName}/git/ref/${ref}`)) as {
        object: { sha: string };
      } | null;
      if (!res) throw holoError({ code: ErrorCode.HOLO_NOT_FOUND, problem: `GitHub ref not found: ${ref}`, fix: 'Check the ref name and repository.' });
      return { sha: res.object.sha };
    },
  };
}
