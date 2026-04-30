// Thin fetch-based Notion API client interface — avoids the @notionhq/client
// bundle and lets tests mock with vi.fn() without any HTTP mocking library.

export interface NotionPage {
  id: string;
  archived: boolean;
  last_edited_time: string;
  last_edited_by?: { id: string; name?: string };
  parent:
    | { type: 'workspace'; workspace: true }
    | { type: 'page_id'; page_id: string }
    | { type: 'database_id'; database_id: string };
  properties?: Record<string, unknown>;
  url?: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  // Rich-text in the block's own type field (e.g. paragraph.rich_text)
  [key: string]: unknown;
}

export interface NotionDatabase {
  id: string;
  archived: boolean;
  title?: Array<{ plain_text: string }>;
}

export interface NotionApiClient {
  pagesRetrieve(pageId: string): Promise<NotionPage | null>;
  blocksChildrenList(
    blockId: string,
    cursor?: string,
  ): Promise<{ results: NotionBlock[]; nextCursor?: string }>;
  databasesQuery(
    databaseId: string,
    cursor?: string,
  ): Promise<{ results: NotionPage[]; nextCursor?: string }>;
  search(
    query: string,
    cursor?: string,
  ): Promise<{ results: NotionPage[]; nextCursor?: string }>;
  usersMe(): Promise<{ id: string; name?: string; workspace_name?: string }>;
}

async function notionFetch(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const err = Object.assign(new Error('Notion 401 Unauthorized'), { status: 401 });
    throw err;
  }
  if (res.status === 404) {
    const err = Object.assign(new Error('Notion 404 Not Found'), { status: 404 });
    throw err;
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
    const err = Object.assign(new Error('Notion 429 Rate Limited'), { status: 429, retryAfter });
    throw err;
  }
  if (!res.ok) throw new Error(`Notion API ${res.status}`);
  return res.json();
}

export function createNotionApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): NotionApiClient {
  return {
    async pagesRetrieve(pageId) {
      try {
        return (await notionFetch(token, 'GET', `/pages/${pageId}`, undefined, fetchImpl)) as NotionPage;
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },

    async blocksChildrenList(blockId, cursor) {
      const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100';
      const res = (await notionFetch(token, 'GET', `/blocks/${blockId}/children${qs}`, undefined, fetchImpl)) as {
        results: NotionBlock[];
        next_cursor?: string;
        has_more: boolean;
      };
      return { results: res.results, nextCursor: res.next_cursor ?? undefined };
    },

    async databasesQuery(databaseId, cursor) {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body['start_cursor'] = cursor;
      const res = (await notionFetch(token, 'POST', `/databases/${databaseId}/query`, body, fetchImpl)) as {
        results: NotionPage[];
        next_cursor?: string;
      };
      return { results: res.results, nextCursor: res.next_cursor ?? undefined };
    },

    async search(query, cursor) {
      const body: Record<string, unknown> = {
        query,
        filter: { property: 'object', value: 'page' },
        page_size: 100,
      };
      if (cursor) body['start_cursor'] = cursor;
      const res = (await notionFetch(token, 'POST', '/search', body, fetchImpl)) as {
        results: NotionPage[];
        next_cursor?: string;
      };
      return { results: res.results, nextCursor: res.next_cursor ?? undefined };
    },

    async usersMe() {
      return (await notionFetch(token, 'GET', '/users/me', undefined, fetchImpl)) as {
        id: string;
        name?: string;
        workspace_name?: string;
      };
    },
  };
}

// Extract plain text from a Notion rich_text array.
export function richTextToPlain(richText: Array<{ plain_text: string }>): string {
  return richText.map((t) => t.plain_text).join('');
}

// Extract inline text from a block (handles the most common block types).
export function blockToText(block: NotionBlock): string {
  const type = block.type as string;
  const inner = block[type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  const rt = inner?.rich_text;
  if (!rt) return '';
  return richTextToPlain(rt);
}
