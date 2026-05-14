import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';
import { adfToPlainText } from '../jira/adf';
import { parseAtlasDocFormat } from './api';
import type {
  ConfluenceComment,
  ConfluencePage,
  ConfluenceSpace,
} from './types';

function buildPageUrl(siteUrl: string, page: ConfluencePage): string {
  const webui = page._links?.webui;
  if (webui && webui.length > 0) {
    // webui is a relative path like `/spaces/ENG/pages/123/Title`. The
    // Confluence API serves these under `/wiki`.
    return `${siteUrl}/wiki${webui}`;
  }
  return `${siteUrl}/wiki/pages/viewpage.action?pageId=${page.id}`;
}

function buildSpaceUrl(siteUrl: string, space: ConfluenceSpace): string {
  return `${siteUrl}/wiki/spaces/${space.key}`;
}

function spaceIdString(space: ConfluencePage['space'] | ConfluenceSpace): string {
  if (!space) return '';
  return String((space as { id: string | number }).id);
}

function pageAcl(page: ConfluencePage, organizationId: string): string[] {
  // Workspace-scope token (Atlassian API token + email): every org member has
  // read access — `org:${id}` is what the Files panel + RAG retrieval check.
  const spaceId = spaceIdString(page.space);
  const base = [`org:${organizationId}`, 'confluence:org'];
  return spaceId ? [...base, `confluence:space:${spaceId}`] : base;
}

function ancestorTrail(page: ConfluencePage): string {
  if (!page.ancestors || page.ancestors.length === 0) return '';
  return page.ancestors
    .map((a) => a.title ?? a.id)
    .filter((s) => s.length > 0)
    .join(' › ');
}

function pageToContent(page: ConfluencePage): string {
  const lines: string[] = [];
  lines.push(page.title);

  const meta: string[] = [];
  if (page.space?.name) meta.push(`Space: ${page.space.name}`);
  if (page.type === 'blogpost') meta.push('Type: blogpost');
  const trail = ancestorTrail(page);
  if (trail.length > 0) meta.push(`Path: ${trail}`);
  if (meta.length > 0) lines.push(meta.join(' · '));

  const body = adfToPlainText(parseAtlasDocFormat(page.body?.atlas_doc_format?.value)).trim();
  if (body.length > 0) {
    lines.push('');
    lines.push(body);
  }
  return lines.join('\n');
}

function pageMetadata(page: ConfluencePage, siteUrl: string): Record<string, unknown> {
  return {
    pageId: page.id,
    type: page.type,
    title: page.title,
    spaceId: spaceIdString(page.space),
    spaceKey: page.space?.key ?? null,
    spaceName: page.space?.name ?? null,
    url: buildPageUrl(siteUrl, page),
    ancestors: (page.ancestors ?? []).map((a) => ({ id: a.id, title: a.title ?? null })),
    versionNumber: page.version?.number ?? null,
    updatedAt: page.version?.when ?? null,
    createdAt: page.history?.createdDate ?? null,
    createdById: page.history?.createdBy?.accountId ?? null,
  };
}

/**
 * Emit one `confluence-page` chunk + one `confluence-comment` chunk per
 * top-level inline/footer comment. All chunks share the parent page's
 * source-artifact id so deletions of the page cascade to its comment
 * chunks.
 */
export async function processPage(
  ctx: ResourceSyncContext<unknown>,
  page: ConfluencePage,
  siteUrl: string,
): Promise<void> {
  const sourceArtifactId = `confluence-page:${page.id}`;
  const acl = pageAcl(page, ctx.organizationId);

  const pageChunk: ChunkUpsert = {
    externalId: page.id,
    kind: 'confluence-page',
    content: pageToContent(page),
    aclSubjects: acl,
    metadata: pageMetadata(page, siteUrl),
    sourceArtifactId,
  };
  await ctx.upsert(pageChunk);

  const comments = page.children?.comment?.results ?? [];
  for (const c of comments) {
    await processComment(ctx, page, c, sourceArtifactId, acl, siteUrl);
  }
}

async function processComment(
  ctx: ResourceSyncContext<unknown>,
  page: ConfluencePage,
  comment: ConfluenceComment,
  sourceArtifactId: string,
  acl: string[],
  siteUrl: string,
): Promise<void> {
  const body = adfToPlainText(parseAtlasDocFormat(comment.body?.atlas_doc_format?.value)).trim();
  const author = comment.history?.createdBy?.displayName ?? 'Unknown';
  const created = comment.history?.createdDate ?? comment.version?.when ?? '';
  const location = comment.extensions?.location ?? 'footer';
  const header = `${location === 'inline' ? 'Inline comment' : 'Comment'} by ${author}${created ? ` · ${created}` : ''}`;
  const content = body.length > 0 ? `${header}\n\n${body}` : header;

  const chunk: ChunkUpsert = {
    externalId: `${page.id}:${comment.id}`,
    kind: 'confluence-comment',
    content,
    aclSubjects: acl,
    metadata: {
      commentId: comment.id,
      pageId: page.id,
      spaceId: spaceIdString(page.space),
      location,
      authorId: comment.history?.createdBy?.accountId ?? null,
      createdAt: comment.history?.createdDate ?? null,
      updatedAt: comment.version?.when ?? null,
      url: `${buildPageUrl(siteUrl, page)}?focusedCommentId=${comment.id}`,
    },
    sourceArtifactId,
  };
  await ctx.upsert(chunk);
}

function spaceToContent(space: ConfluenceSpace): string {
  const lines: string[] = [];
  lines.push(`[${space.key}] ${space.name}`);
  const desc = space.description?.plain?.value?.trim() ?? '';
  if (desc.length > 0) {
    lines.push('');
    lines.push(desc);
  }
  return lines.join('\n');
}

export async function processSpace(
  ctx: ResourceSyncContext<unknown>,
  space: ConfluenceSpace,
  siteUrl: string,
): Promise<void> {
  const id = String(space.id);
  const chunk: ChunkUpsert = {
    externalId: id,
    kind: 'confluence-space',
    content: spaceToContent(space),
    aclSubjects: [`org:${ctx.organizationId}`, `confluence:space:${id}`, 'confluence:org'],
    metadata: {
      spaceId: id,
      key: space.key,
      name: space.name,
      type: space.type ?? null,
      url: buildSpaceUrl(siteUrl, space),
    },
  };
  await ctx.upsert(chunk);
}
