/**
 * Pylon API helpers built on the framework's HttpClient.
 */
import type { HttpClient } from '@holo/connector-framework';
import type { IssuesPage, MessagesPage, PylonMessage } from './types';

/**
 * One page of Pylon's `/issues/search` endpoint. The framework's HttpClient
 * surfaces 401/403 as `HOLO_FETCH_FAILED` (with the URL + status in the
 * message); the spec doesn't need to map them further.
 */
export async function searchIssues(
  api: HttpClient,
  opts: { cursor?: string; updatedAfter?: string },
): Promise<IssuesPage> {
  const body: Record<string, unknown> = { limit: 100 };
  if (opts.cursor) body['cursor'] = opts.cursor;
  if (opts.updatedAfter) {
    body['filter'] = { updated_at: { time_is_after: opts.updatedAfter } };
  }
  return api.post<IssuesPage>('/issues/search', body);
}

/**
 * Fetch all messages for an issue, walking the cursor pagination until the
 * server reports `has_next_page: false`.
 */
export async function listAllMessages(
  api: HttpClient,
  issueId: string,
): Promise<PylonMessage[]> {
  const out: PylonMessage[] = [];
  let cursor: string | undefined;
  do {
    const query: Record<string, string | number> = { limit: 100 };
    if (cursor) query['cursor'] = cursor;
    const page = await api.get<MessagesPage>(`/issues/${issueId}/messages`, { query });
    out.push(...(page.data ?? []));
    cursor =
      page.pagination?.has_next_page && page.pagination.cursor
        ? page.pagination.cursor
        : undefined;
  } while (cursor);
  return out;
}
