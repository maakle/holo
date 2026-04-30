import { notionPageChunker } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import { ErrorCode, holoError } from '@holo/errors';
import type { NotionApiClient, NotionBlock, NotionPage } from './api-client';
import { blockToText } from './api-client';

const MAX_DEPTH = 5;
const BATCH_SIZE = 50;

export type NotionChunkPayload = {
  kind: 'notion-page';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'notion';
  sourceId: string;
  organizationId: string;
};

export type NotionEmbedEnqueueFn = (payload: {
  chunks: NotionChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface RunNotionSyncInput {
  client: NotionApiClient;
  allowedPageIds: string[];
  cursorMetadata: Record<string, unknown>;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: NotionEmbedEnqueueFn;
  logger?: { warn(obj: unknown): void };
}

export interface RunNotionSyncOutput {
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}

export async function runNotionSync(input: RunNotionSyncInput): Promise<RunNotionSyncOutput> {
  if (input.allowedPageIds.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
      problem: 'Notion sync has no allowlisted pages',
      fix: 'Add at least one page or database ID to the Notion allowlist.',
    });
  }

  const logger = input.logger ?? { warn: () => {} };
  const lastEditedPerPage: Record<string, string> = {
    ...((input.cursorMetadata['last_edited_per_page'] as Record<string, string>) ?? {}),
  };
  const breadcrumbCache = new Map<string, string[]>();
  let totalArtifacts = 0;
  const pending: NotionChunkPayload[] = [];

  const flushBatch = async () => {
    if (pending.length === 0) return;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      await input.enqueueEmbed({
        chunks: pending.slice(i, i + BATCH_SIZE),
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
    }
    totalArtifacts += pending.length;
    pending.length = 0;
  };

  for (const rootId of input.allowedPageIds) {
    await processPageTree(rootId, rootId, null, 0);
  }
  await flushBatch();

  return {
    artifactCount: totalArtifacts,
    updatedMetadata: {
      ...input.cursorMetadata,
      last_edited_per_page: lastEditedPerPage,
    },
  };

  async function processPageTree(
    pageId: string,
    rootPageId: string,
    databaseId: string | null,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      logger.warn({ code: 'HOLO_DEPTH_CAP_REACHED', pageId, depth });
      return;
    }

    let page: NotionPage | null;
    try {
      page = await input.client.pagesRetrieve(pageId);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        throw holoError({
          code: ErrorCode.HOLO_NOTION_TOKEN_INVALID,
          problem: 'Notion returned 401 — integration token is invalid or revoked',
          fix: 'Re-create the Notion integration and update the token.',
        });
      }
      if (status === 404) {
        logger.warn({ code: 'HOLO_NOTION_PAGE_NOT_FOUND', pageId });
        return;
      }
      throw err;
    }
    if (!page || page.archived) return;

    // Incremental: skip pages that haven't changed since last sync.
    const prevEdited = lastEditedPerPage[pageId];
    if (prevEdited && page.last_edited_time <= prevEdited) {
      // Still recurse children — they may have changed independently.
      // But skip chunk generation for this page.
    } else {
      const breadcrumb = await buildBreadcrumb(page, breadcrumbCache, input.client);
      const blocks = await collectAllBlocks(input.client, pageId);
      const lastEditedBy =
        (page.last_edited_by as { id?: string } | undefined)?.id ?? 'unknown';

      const chunkInput = {
        pageId,
        databaseId: databaseId ?? undefined,
        breadcrumb,
        blocks: blocks.map((b) => ({
          blockId: b.id,
          type: b.type,
          text: blockToText(b),
        })),
        lastEditedByUser: lastEditedBy,
        lastEditedTime: page.last_edited_time,
        rootPageId,
      };
      const ctx = {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        sourceArtifactId: `notion-page:${pageId}`,
      };
      const chunks = await notionPageChunker.chunk(chunkInput, ctx);

      for (const c of chunks) {
        const hash = chunkHash('notion-page', c.content);
        if (input.existingHashes.has(hash)) continue;
        pending.push({
          kind: 'notion-page',
          content: c.content,
          metadata: c.metadata,
          aclSubjects: c.aclSubjects,
          contentHash: hash,
          sourceArtifactId: `notion-page:${pageId}`,
          provider: 'notion',
          sourceId: input.sourceId,
          organizationId: input.organizationId,
        });
      }
      lastEditedPerPage[pageId] = page.last_edited_time;
    }

    // Recurse into child pages found in blocks.
    if (depth < MAX_DEPTH) {
      const blocks = await collectAllBlocks(input.client, pageId);
      for (const block of blocks) {
        if (block.type === 'child_page') {
          await processPageTree(block.id, rootPageId, null, depth + 1);
        } else if (block.type === 'child_database') {
          await processDatabasePages(block.id, rootPageId, depth + 1);
        }
      }
    }
  }

  async function processDatabasePages(
    databaseId: string,
    rootPageId: string,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let cursor: string | undefined;
    do {
      const res = await input.client.databasesQuery(databaseId, cursor);
      for (const page of res.results) {
        if (!page.archived) {
          await processPageTree(page.id, rootPageId, databaseId, depth + 1);
        }
      }
      cursor = res.nextCursor;
    } while (cursor);
  }
}

async function collectAllBlocks(
  client: NotionApiClient,
  blockId: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.blocksChildrenList(blockId, cursor);
    blocks.push(...res.results);
    cursor = res.nextCursor;
  } while (cursor);
  return blocks;
}

async function buildBreadcrumb(
  page: NotionPage,
  cache: Map<string, string[]>,
  client: NotionApiClient,
): Promise<string[]> {
  const pageId = page.id;
  if (cache.has(pageId)) return cache.get(pageId)!;

  const crumbs: string[] = [];
  let current: NotionPage = page;

  for (let i = 0; i < 10; i++) {
    const parent = current.parent;
    if (!parent || parent.type === 'workspace') break;
    if (parent.type === 'page_id') {
      const parentPage = await client.pagesRetrieve(parent.page_id);
      if (!parentPage) break;
      const title = getPageTitle(parentPage);
      if (title) crumbs.unshift(title);
      if (cache.has(parent.page_id)) {
        crumbs.unshift(...cache.get(parent.page_id)!);
        break;
      }
      current = parentPage;
    } else {
      break;
    }
  }

  cache.set(pageId, crumbs);
  return crumbs;
}

function getPageTitle(page: NotionPage): string {
  const titleProp = Object.values(page.properties ?? {}).find(
    (p) => (p as { type?: string }).type === 'title',
  ) as { title?: Array<{ plain_text: string }> } | undefined;
  return titleProp?.title?.map((t) => t.plain_text).join('') ?? '';
}

// Coverage panel: list all pages visible to the integration and cross-ref allowlist.
export async function computeNotionCoverage(
  client: NotionApiClient,
  allowedPageIds: string[],
): Promise<{
  sharedRootPageCount: number;
  allowlistedRootPageCount: number;
  reachableChildPageCount: number;
  shareMoreUrl: string;
}> {
  const allowedSet = new Set(allowedPageIds);
  const allShared: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.search('', cursor);
    allShared.push(...res.results);
    cursor = res.nextCursor;
  } while (cursor);

  const intersection = allShared.filter((p) => allowedSet.has(p.id));
  let reachableCount = 0;

  for (const page of intersection) {
    reachableCount += await countChildPages(client, page.id, 0, 200);
  }

  return {
    sharedRootPageCount: allShared.length,
    allowlistedRootPageCount: intersection.length,
    reachableChildPageCount: reachableCount,
    shareMoreUrl: 'https://www.notion.so/my-integrations',
  };
}

async function countChildPages(
  client: NotionApiClient,
  blockId: string,
  depth: number,
  cap: number,
): Promise<number> {
  if (depth > 5) return 0;
  let count = 1; // count self
  const blocks = await collectAllBlocks(client, blockId);
  for (const b of blocks) {
    if (count >= cap) break;
    if (b.type === 'child_page') {
      count += await countChildPages(client, b.id, depth + 1, cap - count);
    }
  }
  return count;
}
