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
  const res = await fetchImpl(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401) {
    const err = Object.assign(new Error('GitHub 401'), { status: 401 });
    throw err;
  }
  if (res.status === 404) {
    return null;
  }
  if (res.status === 403) {
    const retryAfter = res.headers.get('X-RateLimit-Reset');
    const err = Object.assign(new Error('GitHub 403 rate limit'), {
      status: 403,
      retryAfter: retryAfter ? parseInt(retryAfter, 10) : undefined,
    });
    throw err;
  }
  if (!res.ok) throw holoError({ code: ErrorCode.HOLO_FETCH_FAILED, problem: `GitHub API ${res.status} ${path}`, fix: 'Check the request parameters and token permissions.' });
  return res.json();
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
