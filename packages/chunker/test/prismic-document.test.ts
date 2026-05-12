import { describe, it, expect } from 'vitest';
import {
  prismicDocumentChunker,
  type PrismicDocumentInput,
} from '../src/prismic-document';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'prismic-document:beglaubigt:Y-x1abcd',
};

function baseInput(content: string): PrismicDocumentInput {
  return {
    repo: 'beglaubigt',
    id: 'Y-x1abcd',
    uid: 'how-it-works',
    type: 'faq',
    lang: 'de-de',
    lastPublicationDate: '2026-04-30T12:00:00.000Z',
    tags: ['public'],
    content,
  };
}

describe('prismicDocumentChunker', () => {
  it('emits no chunks for empty content', async () => {
    const chunks = await prismicDocumentChunker.chunk(baseInput('   \n  '), ctx);
    expect(chunks).toHaveLength(0);
  });

  it('emits one chunk for a short document with breadcrumb + metadata', async () => {
    const chunks = await prismicDocumentChunker.chunk(
      baseInput('## Wie funktioniert das?\n\nSie laden ein Dokument hoch.'),
      ctx,
    );
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.content.startsWith('faq / how-it-works')).toBe(true);
    expect(c.parentExternalId).toBe(ctx.sourceArtifactId);
    expect(c.metadata.prismic_repo).toBe('beglaubigt');
    expect(c.metadata.prismic_document_id).toBe('Y-x1abcd');
    expect(c.metadata.prismic_uid).toBe('how-it-works');
    expect(c.metadata.prismic_type).toBe('faq');
    expect(c.metadata.lang).toBe('de-de');
    expect(c.metadata.tags).toEqual(['public']);
    expect(c.aclSubjects).toEqual(['org:org-1']);
  });

  it('falls back to the document id in the breadcrumb when uid is null', async () => {
    const input = { ...baseInput('Hallo Welt'), uid: null };
    const chunks = await prismicDocumentChunker.chunk(input, ctx);
    expect(chunks[0]!.content.startsWith('faq / Y-x1abcd')).toBe(true);
    expect(chunks[0]!.metadata.prismic_uid).toBeNull();
  });

  it('splits long content into multiple chunks and labels their indices', async () => {
    // The recursive splitter's chunk size is 1200; build a body that's
    // unambiguously beyond a single chunk.
    const long = ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(80));
    const chunks = await prismicDocumentChunker.chunk(baseInput(long), ctx);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.metadata.chunk_index).toBe(0);
    expect(chunks[0]!.metadata.chunk_count).toBe(chunks.length);
    for (const c of chunks) {
      expect(c.content.startsWith('faq / how-it-works')).toBe(true);
    }
  });
});
