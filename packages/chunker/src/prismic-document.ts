import type { Chunk, ChunkContext, Chunker } from './contract';
import { recursiveSplit } from './recursive-split';

export interface PrismicDocumentInput {
  /** Prismic repo slug (e.g. `beglaubigt`). */
  repo: string;
  /** Document id (opaque Prismic id). Used in metadata + canonical URL. */
  id: string;
  /** Document UID (editor-controlled slug); null on docs without a UID field. */
  uid: string | null;
  /** Custom-type slug (e.g. `faq`, `page`, `blog_post`). */
  type: string;
  /** Locale code (e.g. `en-us`). */
  lang: string;
  /** ISO timestamp; surfaced in metadata for freshness display. */
  lastPublicationDate: string;
  /** Tags array (may be empty). */
  tags: string[];
  /**
   * Plain-text or markdown body extracted from the document's data blob.
   * The connector is responsible for the conversion (see
   * `documentToMarkdown` in @holo/connectors/prismic).
   */
  content: string;
}

const CHUNK_SIZE = 1200;
const OVERLAP = 150;

export const prismicDocumentChunker: Chunker<PrismicDocumentInput> = {
  kind: 'prismic-document',
  embeddingModel: 'openai-3-small',
  async chunk(input: PrismicDocumentInput, ctx: ChunkContext): Promise<Chunk[]> {
    if (input.content.trim().length === 0) return [];
    const aclSubjects = [`org:${ctx.organizationId}`];
    const slug = input.uid ?? input.id;
    const header = `${input.type} / ${slug}`;
    const pieces = recursiveSplit(input.content, {
      chunkSize: CHUNK_SIZE,
      overlap: OVERLAP,
    });
    return pieces.map((text, idx) => ({
      content: `${header}\n\n${text}`,
      parentExternalId: ctx.sourceArtifactId,
      metadata: {
        prismic_repo: input.repo,
        prismic_document_id: input.id,
        prismic_uid: input.uid,
        prismic_type: input.type,
        lang: input.lang,
        last_publication_date: input.lastPublicationDate,
        tags: input.tags,
        chunk_index: idx,
        chunk_count: pieces.length,
      },
      aclSubjects,
    }));
  },
};
