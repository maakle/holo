/**
 * Google Chat REST API helpers built on the framework's HttpClient.
 *
 * Chat exposes everything under https://chat.googleapis.com/v1. We use:
 *   - GET /v1/spaces                                   (list spaces user is in)
 *   - GET /v1/{space}/messages?orderBy=createTime asc  (list messages, with filter)
 *
 * The framework's HttpClient injects the `Authorization: Bearer <token>` header
 * via the OAuth2 strategy and handles 429/5xx retry with exponential backoff.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  GoogleChatMessage,
  GoogleChatSpace,
  ListMessagesResponse,
  ListSpacesResponse,
} from './types';

/**
 * One page of `GET /v1/spaces`. The framework's authHeader injects the bearer
 * token. Defaults to 1000 (the API's max page size) since spaces are bounded
 * per workspace and we want one round-trip in the common case.
 */
export async function listSpacesPage(
  api: HttpClient,
  opts: { pageToken?: string },
): Promise<ListSpacesResponse> {
  const query: Record<string, string | number> = { pageSize: 1000 };
  if (opts.pageToken) query['pageToken'] = opts.pageToken;
  return api.get<ListSpacesResponse>('/v1/spaces', { query });
}

/** Walk every page of `GET /v1/spaces` and return the flat list. */
export async function listAllSpaces(api: HttpClient): Promise<GoogleChatSpace[]> {
  const out: GoogleChatSpace[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listSpacesPage(api, { pageToken });
    if (page.spaces) out.push(...page.spaces);
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

/**
 * One page of `GET /v1/{space}/messages`. Chat's `filter` accepts
 * `createTime > "<rfc3339>"` for incremental syncs; ordering by createTime
 * ascending lets us advance the cursor monotonically.
 *
 * `spaceName` is the full resource name (`spaces/AAAA1234`), not just the id.
 */
export async function listMessagesPage(
  api: HttpClient,
  spaceName: string,
  opts: { pageToken?: string; createdAfter?: string },
): Promise<ListMessagesResponse> {
  const query: Record<string, string | number> = {
    pageSize: 100,
    orderBy: 'createTime asc',
  };
  if (opts.pageToken) query['pageToken'] = opts.pageToken;
  if (opts.createdAfter) {
    query['filter'] = `createTime > "${opts.createdAfter}"`;
  }
  return api.get<ListMessagesResponse>(`/v1/${spaceName}/messages`, { query });
}

/**
 * Fetch all messages on a single thread. Chat exposes thread membership via
 * `filter=thread.name = "<thread>"` on the same `/messages` endpoint — no
 * dedicated replies route. Used to assemble a thread's full message list
 * once we've seen its parent in the channel sweep.
 */
export async function listThreadMessages(
  api: HttpClient,
  threadName: string,
): Promise<GoogleChatMessage[]> {
  const spaceName = threadName.split('/threads/')[0];
  if (!spaceName) return [];
  const out: GoogleChatMessage[] = [];
  let pageToken: string | undefined;
  do {
    const query: Record<string, string | number> = {
      pageSize: 100,
      orderBy: 'createTime asc',
      filter: `thread.name = "${threadName}"`,
    };
    if (pageToken) query['pageToken'] = pageToken;
    const page = await api.get<ListMessagesResponse>(`/v1/${spaceName}/messages`, { query });
    if (page.messages) out.push(...page.messages);
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}
