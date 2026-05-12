import type { Chunk, ChunkContext, Chunker } from './contract';
import { recursiveSplit } from './recursive-split';

export interface WebcrawlPageInput {
  /** Canonical absolute URL of the page (after redirects). */
  url: string;
  /** Page title from `<title>` / `og:title` when Firecrawl surfaces one. */
  title: string;
  /** Markdown body Firecrawl produced. */
  content: string;
  /** Mode the parent source was configured with — surfaced in metadata. */
  mode: 'scrape' | 'crawl';
  /** Seed URL for crawl-mode pages; equals `url` for scrape-mode rows. */
  seedUrl: string;
}

const CHUNK_SIZE = 1200;
const OVERLAP = 150;

export const webcrawlPageChunker: Chunker<WebcrawlPageInput> = {
  kind: 'webcrawl-page',
  embeddingModel: 'openai-3-small',
  async chunk(input: WebcrawlPageInput, ctx: ChunkContext): Promise<Chunk[]> {
    if (input.content.trim().length === 0) return [];
    const aclSubjects = [`org:${ctx.organizationId}`];
    const header = input.title.length > 0 ? `${input.title}\n${input.url}` : input.url;
    const pieces = recursiveSplit(input.content, {
      chunkSize: CHUNK_SIZE,
      overlap: OVERLAP,
    });
    return pieces.map((text, idx) => ({
      content: `${header}\n\n${text}`,
      parentExternalId: ctx.sourceArtifactId,
      metadata: {
        url: input.url,
        title: input.title,
        mode: input.mode,
        seed_url: input.seedUrl,
        chunk_index: idx,
        chunk_count: pieces.length,
      },
      aclSubjects,
    }));
  },
};
