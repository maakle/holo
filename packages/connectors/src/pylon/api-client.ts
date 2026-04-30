import { holoError, ErrorCode } from '@holo/errors';

export interface PylonIssue {
  id: string;
  number: number;
  title: string;
  body_html: string;
  type: 'conversation' | 'ticket';
  state: string;
  source: string;
  created_at: string;
  updated_at: string;
  latest_message_time?: string;
  link: string;
  account?: { id: string; external_ids: Array<{ external_id: string; label: string }> };
  assignee?: { id: string; email: string };
  requester?: { id: string; email: string };
  team?: { id: string };
  tags: string[];
}

export interface PylonMessage {
  id: string;
  thread_id: string;
  message_html: string;
  is_private: boolean;
  source: string;
  timestamp: string;
  file_urls: string[];
  author: {
    name: string;
    avatar_url: string;
    user?: { id: string; email: string };
    contact?: { id: string; email: string };
  };
}

export interface PylonApiClient {
  listIssues(opts: { updatedAfter?: string; cursor?: string }): Promise<{
    issues: PylonIssue[];
    nextCursor?: string;
  }>;
  getIssueMessages(issueId: string): Promise<PylonMessage[]>;
  testConnection(): Promise<{ id: string; name: string }>;
}

export function createPylonApiClient(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): PylonApiClient {
  const base = 'https://api.usepylon.com';

  const defaultHeaders = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  async function apiFetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${base}${path}`;
    const res = await fetchImpl(url, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers ?? {}) },
    });
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Pylon API error ${res.status} at ${path}`,
        fix: 'Verify the Pylon API key and that the requested resource exists.',
      });
    }
    return res.json() as Promise<T>;
  }

  return {
    async listIssues(opts) {
      const body: Record<string, unknown> = { limit: 100 };
      if (opts.cursor) body['cursor'] = opts.cursor;
      if (opts.updatedAfter) {
        body['filter'] = { updated_at: { time_is_after: opts.updatedAfter } };
      }
      const raw = await apiFetch<{
        data: PylonIssue[];
        pagination: { cursor: string | null; has_next_page: boolean };
      }>('/issues/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return {
        issues: raw.data ?? [],
        nextCursor: raw.pagination?.has_next_page && raw.pagination.cursor
          ? raw.pagination.cursor
          : undefined,
      };
    },

    async getIssueMessages(issueId) {
      const allMessages: PylonMessage[] = [];
      let cursor: string | undefined;

      do {
        const queryParams = new URLSearchParams({ limit: '100' });
        if (cursor) queryParams.set('cursor', cursor);

        const raw = await apiFetch<{
          data: PylonMessage[];
          pagination: { cursor: string | null; has_next_page: boolean };
        }>(`/issues/${issueId}/messages?${queryParams.toString()}`);

        allMessages.push(...(raw.data ?? []));
        cursor = raw.pagination?.has_next_page && raw.pagination.cursor
          ? raw.pagination.cursor
          : undefined;
      } while (cursor);

      return allMessages;
    },

    async testConnection() {
      const raw = await apiFetch<{ data: { id: string; name: string } }>('/me');
      return { id: raw.data.id, name: raw.data.name };
    },
  };
}
