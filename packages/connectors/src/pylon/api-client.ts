import { holoError, ErrorCode } from '@holo/errors';

export interface PylonIssue {
  id: string;
  title: string;
  status: string;
  priority?: string;
  created_at: string;
  updated_at: string;
  customer?: { name: string; email?: string };
  company?: { name: string };
  assignee?: { name: string };
  tags: string[];
}

export interface PylonIssueMessage {
  id: string;
  author: string;
  author_type: 'customer' | 'agent' | 'bot';
  created_at: string;
  body: string;
}

export interface PylonApiClient {
  listIssues(opts: { updatedAfter?: string; cursor?: string }): Promise<{
    issues: PylonIssue[];
    nextCursor?: string;
  }>;
  getIssueMessages(issueId: string): Promise<PylonIssueMessage[]>;
}

export function createPylonApiClient(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): PylonApiClient {
  const base = 'https://api.usepylon.com/v1';

  async function apiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${base}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Pylon API error ${res.status} at ${path}`,
        fix: 'Verify the Pylon access token and that the requested resource exists.',
      });
    }
    return res.json() as Promise<T>;
  }

  return {
    async listIssues(opts) {
      const params: Record<string, string> = {};
      if (opts.updatedAfter) params['updated_after'] = opts.updatedAfter;
      if (opts.cursor) params['cursor'] = opts.cursor;
      const raw = await apiFetch<{
        issues: PylonIssue[];
        next_cursor?: string;
      }>('/issues', params);
      return { issues: raw.issues ?? [], nextCursor: raw.next_cursor };
    },

    async getIssueMessages(issueId) {
      const raw = await apiFetch<{ messages: PylonIssueMessage[] }>(
        `/issues/${issueId}/messages`,
      );
      return raw.messages ?? [];
    },
  };
}
