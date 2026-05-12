/**
 * Webcrawl page → chunk projection. One source-artifact per page; the
 * recursive splitter inside `webcrawlPageChunker` decides how many chunks
 * each page becomes.
 */
import { webcrawlPageChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { FirecrawlPage, WebcrawlMode } from './types';

export async function emitPageChunks(
  ctx: ResourceSyncContext<unknown>,
  args: { page: FirecrawlPage; mode: WebcrawlMode; seedUrl: string },
): Promise<void> {
  const sourceArtifactId = `webcrawl-page:${args.page.url}`;
  const chunks = await webcrawlPageChunker.chunk(
    {
      url: args.page.url,
      title: args.page.metadata?.title ?? '',
      content: args.page.markdown,
      mode: args.mode,
      seedUrl: args.seedUrl,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );
  for (const c of chunks) {
    await ctx.upsert({
      externalId: args.page.url,
      kind: 'webcrawl-page',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
