/**
 * Prismic document → chunk projection.
 *
 * One source-artifact per document; the chunker decides how many chunks the
 * body becomes. We key the artifact id on the Prismic document id (stable
 * across renames) so re-chunking on incremental syncs replaces the prior
 * chunk set cleanly.
 */
import { prismicDocumentChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import { documentToMarkdown } from './api';
import type { PrismicDocument } from './types';

export async function emitDocumentChunks(
  ctx: ResourceSyncContext<unknown>,
  args: { repo: string; doc: PrismicDocument },
): Promise<void> {
  const sourceArtifactId = `prismic-document:${args.repo}:${args.doc.id}`;
  const content = documentToMarkdown(args.doc);
  const chunks = await prismicDocumentChunker.chunk(
    {
      repo: args.repo,
      id: args.doc.id,
      uid: args.doc.uid,
      type: args.doc.type,
      lang: args.doc.lang,
      lastPublicationDate: args.doc.last_publication_date,
      tags: args.doc.tags,
      content,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );
  for (const c of chunks) {
    await ctx.upsert({
      externalId: args.doc.id,
      kind: 'prismic-document',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}
