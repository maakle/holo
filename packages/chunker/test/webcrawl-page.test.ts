import { describe, it, expect } from 'vitest';
import {
  webcrawlPageChunker,
  type WebcrawlPageInput,
} from '../src/webcrawl-page';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'webcrawl-page:https://beglaubigt.de/faq',
};

function baseInput(content: string, overrides: Partial<WebcrawlPageInput> = {}): WebcrawlPageInput {
  return {
    url: 'https://beglaubigt.de/faq',
    title: 'FAQ',
    content,
    mode: 'scrape',
    seedUrl: 'https://beglaubigt.de/faq',
    ...overrides,
  };
}

describe('webcrawlPageChunker', () => {
  it('emits no chunks for empty content', async () => {
    const chunks = await webcrawlPageChunker.chunk(baseInput('   \n  '), ctx);
    expect(chunks).toHaveLength(0);
  });

  it('emits a single chunk for short content with title + URL header', async () => {
    const chunks = await webcrawlPageChunker.chunk(
      baseInput('Wie funktioniert die Beglaubigung?\n\nSie laden ein Dokument hoch.'),
      ctx,
    );
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.content.startsWith('FAQ\nhttps://beglaubigt.de/faq')).toBe(true);
    expect(c.parentExternalId).toBe(ctx.sourceArtifactId);
    expect(c.metadata.url).toBe('https://beglaubigt.de/faq');
    expect(c.metadata.mode).toBe('scrape');
    expect(c.metadata.seed_url).toBe('https://beglaubigt.de/faq');
    expect(c.aclSubjects).toEqual(['org:org-1']);
  });

  it('falls back to URL-only header when title is empty', async () => {
    const chunks = await webcrawlPageChunker.chunk(
      baseInput('Hallo Welt', { title: '' }),
      ctx,
    );
    expect(chunks[0]!.content.startsWith('https://beglaubigt.de/faq')).toBe(true);
  });

  it('marks crawl-mode chunks with the seed URL distinct from the page URL', async () => {
    const chunks = await webcrawlPageChunker.chunk(
      baseInput('content', {
        url: 'https://beglaubigt.de/faq/payment',
        mode: 'crawl',
        seedUrl: 'https://beglaubigt.de/faq',
      }),
      ctx,
    );
    expect(chunks[0]!.metadata.mode).toBe('crawl');
    expect(chunks[0]!.metadata.url).toBe('https://beglaubigt.de/faq/payment');
    expect(chunks[0]!.metadata.seed_url).toBe('https://beglaubigt.de/faq');
  });

  it('splits long content into multiple chunks with stable chunk indices', async () => {
    const long = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(80);
    const chunks = await webcrawlPageChunker.chunk(baseInput(long), ctx);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.metadata.chunk_index).toBe(0);
    expect(chunks[0]!.metadata.chunk_count).toBe(chunks.length);
  });
});
