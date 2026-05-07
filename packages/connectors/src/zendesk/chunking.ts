/**
 * Zendesk article → chunk projection. One chunk batch per article via the
 * @holo/chunker zendeskArticleChunker. Drafts and outdated articles are
 * skipped so retrieval doesn't surface stale content.
 */
import { zendeskArticleChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { ZendeskArticle } from './types';

export interface ProcessArticleArgs {
  baseUrl: string;
  article: ZendeskArticle;
  /** sectionId → { name, categoryId } from the precomputed lookup. */
  sections: Map<number, { name: string; categoryId: number | null }>;
  /** categoryId → name from the precomputed lookup. */
  categories: Map<number, string>;
}

export async function emitArticleChunks(
  ctx: ResourceSyncContext<unknown>,
  args: ProcessArticleArgs,
): Promise<void> {
  if (args.article.draft || args.article.outdated) return;

  const sectionInfo = args.article.section_id
    ? args.sections.get(args.article.section_id)
    : undefined;
  const sectionName = sectionInfo?.name ?? '';
  const categoryName = sectionInfo?.categoryId
    ? (args.categories.get(sectionInfo.categoryId) ?? '')
    : '';

  const sourceArtifactId = `zendesk-article:${args.baseUrl}:${args.article.id}`;
  const rawChunks = await zendeskArticleChunker.chunk(
    {
      baseUrl: args.baseUrl,
      articleId: args.article.id,
      title: args.article.title,
      htmlUrl: args.article.html_url,
      locale: args.article.locale,
      section: sectionName,
      category: categoryName,
      updatedAt: args.article.updated_at,
      bodyHtml: args.article.body,
      voteSum: args.article.vote_sum,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: String(args.article.id),
      kind: 'zendesk-article',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
