/**
 * Notion record → chunk projection.
 *
 * Walks a page's block tree (recursing into child pages and child databases)
 * and produces ChunkUpsert payloads via @holo/chunker's notionPageChunker.
 * The breadcrumb cache lives across pages within one sync run so we don't
 * re-fetch the same parent chains repeatedly on a deep workspace.
 */
import { notionPageChunker } from '@holo/chunker';
import type {
  ChunkUpsert,
  HttpClient,
  ResourceSyncContext,
} from '@holo/connector-framework';
import {
  blockToText,
  collectAllBlocks,
  iterateDatabasePages,
  isStatus,
  pagesRetrieve,
} from './api';
import type { NotionPage } from './types';

const MAX_DEPTH = 5;

export interface ProcessPagesInput {
  /** Page ids to start traversal from (the resolved allowlist or a wildcard expansion). */
  rootPageIds: ReadonlyArray<string>;
  /** Last edited time per page id from the previous run; used to skip unchanged pages. */
  lastEditedPerPage: Record<string, string>;
  ctx: ResourceSyncContext<{ lastEditedPerPage: Record<string, string> }>;
}

export interface ProcessPagesOutput {
  /** Updated watermark map — caller persists as the new cursor. */
  lastEditedPerPage: Record<string, string>;
}

/**
 * Walk every root page (and its descendants up to MAX_DEPTH), emitting one
 * notion-page chunk batch per page that's newer than its watermark. Pages
 * unchanged since the last sync are skipped — but we still recurse into their
 * children, since a leaf could change without bubbling its parent's
 * last_edited_time.
 */
export async function processPages(input: ProcessPagesInput): Promise<ProcessPagesOutput> {
  const { ctx, rootPageIds } = input;
  const watermarks: Record<string, string> = { ...input.lastEditedPerPage };
  const breadcrumbCache = new Map<string, string[]>();

  const total = rootPageIds.length;
  for (let i = 0; i < rootPageIds.length; i += 1) {
    ctx.signal?.throwIfAborted();
    ctx.reportProgress?.({
      current: i,
      total,
      message: `Indexing page ${i + 1} of ${total}`,
    });
    const rootId = rootPageIds[i]!;
    await processPageTree(ctx, watermarks, breadcrumbCache, rootId, rootId, null, 0);
    // Per-page checkpoint so a mid-sync crash doesn't replay the whole tree.
    await ctx.flushCursor({ lastEditedPerPage: watermarks });
  }
  ctx.reportProgress?.({ current: total, total, message: 'Notion sync complete' });

  return { lastEditedPerPage: watermarks };
}

async function processPageTree(
  ctx: ResourceSyncContext<{ lastEditedPerPage: Record<string, string> }>,
  watermarks: Record<string, string>,
  breadcrumbCache: Map<string, string[]>,
  pageId: string,
  rootPageId: string,
  databaseId: string | null,
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let page: NotionPage | null;
  try {
    page = await pagesRetrieve(ctx.api, pageId);
  } catch (err) {
    if (isStatus(err, 401) || isStatus(err, 404)) return;
    throw err;
  }
  if (!page || page.archived) return;

  const previouslyEdited = watermarks[pageId];
  const skipChunkEmission =
    previouslyEdited !== undefined && page.last_edited_time <= previouslyEdited;

  if (!skipChunkEmission) {
    const breadcrumb = await buildBreadcrumb(ctx.api, page, breadcrumbCache);
    const blocks = await collectAllBlocks(ctx.api, pageId, ctx.signal);
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

    const sourceArtifactId = `notion-page:${pageId}`;
    const rawChunks = await notionPageChunker.chunk(chunkInput, {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    });

    // Notion page URLs are synthesizable from the page id (hyphens stripped).
    const url = `https://www.notion.so/${pageId.replace(/-/g, '')}`;
    for (const c of rawChunks) {
      await ctx.upsert({
        externalId: pageId,
        kind: 'notion-page',
        content: c.content,
        metadata: { ...c.metadata, url },
        aclSubjects: c.aclSubjects,
        sourceArtifactId,
      } satisfies ChunkUpsert);
    }
    watermarks[pageId] = page.last_edited_time;
  }

  // Recurse into child pages and child databases. Even when the parent was
  // skipped, a leaf descendant could have changed independently.
  if (depth < MAX_DEPTH) {
    const blocks = await collectAllBlocks(ctx.api, pageId, ctx.signal);
    for (const block of blocks) {
      ctx.signal?.throwIfAborted();
      if (block.type === 'child_page') {
        await processPageTree(
          ctx,
          watermarks,
          breadcrumbCache,
          block.id,
          rootPageId,
          null,
          depth + 1,
        );
      } else if (block.type === 'child_database') {
        for await (const child of iterateDatabasePages(ctx.api, block.id, ctx.signal)) {
          if (!child.archived) {
            await processPageTree(
              ctx,
              watermarks,
              breadcrumbCache,
              child.id,
              rootPageId,
              block.id,
              depth + 1,
            );
          }
        }
      }
    }
  }
}

async function buildBreadcrumb(
  api: HttpClient,
  page: NotionPage,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const pageId = page.id;
  const cached = cache.get(pageId);
  if (cached) return cached;

  const crumbs: string[] = [];
  let current: NotionPage = page;

  for (let i = 0; i < 10; i += 1) {
    const parent = current.parent;
    if (!parent || parent.type === 'workspace') break;
    if (parent.type !== 'page_id') break;
    const parentPage = await pagesRetrieve(api, parent.page_id);
    if (!parentPage) break;
    const title = pageTitle(parentPage);
    if (title) crumbs.unshift(title);
    const cachedParent = cache.get(parent.page_id);
    if (cachedParent) {
      crumbs.unshift(...cachedParent);
      break;
    }
    current = parentPage;
  }

  cache.set(pageId, crumbs);
  return crumbs;
}

function pageTitle(page: NotionPage): string {
  const titleProp = Object.values(page.properties ?? {}).find(
    (p) => (p as { type?: string }).type === 'title',
  ) as { title?: Array<{ plain_text: string }> } | undefined;
  return titleProp?.title?.map((t) => t.plain_text).join('') ?? '';
}
