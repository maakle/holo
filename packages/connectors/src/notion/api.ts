/**
 * Thin Notion API helpers built on the framework's HttpClient.
 *
 * The framework's HttpClient wraps fetch with rate-limit + retry + auth.
 * Notion's API needs an extra `Notion-Version` header (per their docs);
 * everything else is standard JSON.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  NotionBlock,
  NotionBlockList,
  NotionPage,
  NotionPageList,
  NotionViewer,
} from './types';

/** Header the spec wires through `http.defaultHeaders`. */
export const NOTION_VERSION_HEADER = '2022-06-28';

/** Retrieve a single page; returns null on 404. */
export async function pagesRetrieve(
  api: HttpClient,
  pageId: string,
): Promise<NotionPage | null> {
  try {
    return await api.get<NotionPage>(`/pages/${pageId}`);
  } catch (err) {
    if (isStatus(err, 404)) return null;
    throw err;
  }
}

export async function* iterateBlockChildren(
  api: HttpClient,
  blockId: string,
  signal?: AbortSignal,
): AsyncGenerator<NotionBlock> {
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const query: Record<string, string | number> = { page_size: 100 };
    if (cursor) query['start_cursor'] = cursor;
    const res = await api.get<NotionBlockList>(`/blocks/${blockId}/children`, { query });
    for (const b of res.results) yield b;
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
}

export async function collectAllBlocks(
  api: HttpClient,
  blockId: string,
  signal?: AbortSignal,
): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  for await (const b of iterateBlockChildren(api, blockId, signal)) out.push(b);
  return out;
}

export async function* iterateDatabasePages(
  api: HttpClient,
  databaseId: string,
  signal?: AbortSignal,
): AsyncGenerator<NotionPage> {
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body['start_cursor'] = cursor;
    const res = await api.post<NotionPageList>(`/databases/${databaseId}/query`, body);
    for (const p of res.results) yield p;
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
}

export async function* iterateAllAccessiblePages(
  api: HttpClient,
  signal?: AbortSignal,
): AsyncGenerator<NotionPage> {
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const body: Record<string, unknown> = {
      query: '',
      filter: { property: 'object', value: 'page' },
      page_size: 100,
    };
    if (cursor) body['start_cursor'] = cursor;
    const res = await api.post<NotionPageList>('/search', body);
    for (const p of res.results) yield p;
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
}

export async function viewer(api: HttpClient): Promise<NotionViewer> {
  return api.get<NotionViewer>('/users/me');
}

export function isStatus(err: unknown, status: number): boolean {
  // The framework's HoloError wraps the status code in the `problem` text
  // (e.g. 'GET https://… returned 404'). Plain Error subclasses with a
  // `status` field also pass through.
  if (err && typeof err === 'object') {
    if ((err as { status?: unknown }).status === status) return true;
    const problem = (err as { problem?: unknown }).problem;
    if (typeof problem === 'string' && problem.includes(`returned ${status}`)) return true;
  }
  return false;
}

/** Plain text from a Notion rich_text array. */
export function richTextToPlain(richText: Array<{ plain_text: string }>): string {
  return richText.map((t) => t.plain_text).join('');
}

/** Plain text from a block's per-type inline body (handles common types). */
export function blockToText(block: NotionBlock): string {
  const inner = block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  return inner?.rich_text ? richTextToPlain(inner.rich_text) : '';
}
