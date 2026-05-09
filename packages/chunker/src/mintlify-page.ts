import type { Chunk, ChunkContext, Chunker } from './contract';
import { recursiveSplit } from './recursive-split';

export interface MintlifyPageInput {
  /** Site root (e.g. `https://docs.kombo.dev`). */
  baseUrl: string;
  /** Page path within the site (e.g. `/introduction`). */
  path: string;
  /** Page title from the breadcrumb / llms.txt entry. */
  title: string;
  /** Section heading from llms.txt (e.g. "API Reference"); empty if none. */
  section: string;
  /** Markdown body fetched from `<baseUrl><path>.md`. */
  content: string;
}

const CHUNK_SIZE = 1200;
const OVERLAP = 150;

export const mintlifyPageChunker: Chunker<MintlifyPageInput> = {
  kind: 'mintlify-page',
  embeddingModel: 'openai-3-small',
  async chunk(input: MintlifyPageInput, ctx: ChunkContext): Promise<Chunk[]> {
    if (input.content.trim().length === 0) return [];

    const url = `${input.baseUrl.replace(/\/+$/, '')}${input.path}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const breadcrumb = input.section
      ? `${input.section} / ${input.title}`
      : input.title;

    const pieces = recursiveSplit(input.content, {
      chunkSize: CHUNK_SIZE,
      overlap: OVERLAP,
    });

    return pieces.map((text, idx) => ({
      content: `${breadcrumb}\n${url}\n\n${text}`,
      parentExternalId: ctx.sourceArtifactId,
      metadata: {
        url,
        path: input.path,
        title: input.title,
        section: input.section,
        chunk_index: idx,
        chunk_count: pieces.length,
      },
      aclSubjects,
    }));
  },
};
