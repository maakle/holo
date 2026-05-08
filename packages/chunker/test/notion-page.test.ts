import { describe, it, expect } from 'vitest';
import { notionPageChunker, type NotionPageInput } from '../src/notion-page';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function basePage(blocks: NotionPageInput['blocks']): NotionPageInput {
  return {
    pageId: 'page-1',
    breadcrumb: ['Engineering', 'Architecture'],
    blocks,
    lastEditedByUser: 'user-1',
    lastEditedTime: '2026-04-30T12:00:00.000Z',
    rootPageId: 'root-1',
  };
}

describe('notionPageChunker', () => {
  it('5-block page → 5 block chunks + 1 page chunk = 6', async () => {
    const blocks = Array.from({ length: 5 }, (_, i) => ({
      blockId: `b${i}`,
      type: 'paragraph',
      text: `block ${i}`,
    }));
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    expect(chunks).toHaveLength(6);
    const blockKindCount = chunks.filter((c) => c.metadata.kind === 'block').length;
    const pageKindCount = chunks.filter((c) => c.metadata.kind === 'page').length;
    expect(blockKindCount).toBe(5);
    expect(pageKindCount).toBe(1);
    const pageChunk = chunks.find((c) => c.metadata.kind === 'page')!;
    expect(pageChunk.metadata.block_id).toBeUndefined();
  });

  it('3-block page → 3 block chunks only (no page summary)', async () => {
    const blocks = Array.from({ length: 3 }, (_, i) => ({
      blockId: `b${i}`,
      type: 'paragraph',
      text: `block ${i}`,
    }));
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.metadata.kind === 'block')).toBe(true);
  });

  it('2-block page → 2 block chunks only', async () => {
    const blocks = [
      { blockId: 'b0', type: 'paragraph', text: 'a' },
      { blockId: 'b1', type: 'paragraph', text: 'b' },
    ];
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    expect(chunks).toHaveLength(2);
  });

  it('block with text "   " is skipped', async () => {
    const blocks = [
      { blockId: 'b0', type: 'paragraph', text: 'real content' },
      { blockId: 'b1', type: 'paragraph', text: '   ' },
    ];
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata.block_id).toBe('b0');
  });

  it('page exceeding 12,000 chars → page chunk ends with [truncated]', async () => {
    const longText = 'x'.repeat(2000);
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      blockId: `b${i}`,
      type: 'paragraph',
      text: longText,
    }));
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    const pageChunk = chunks.find((c) => c.metadata.kind === 'page')!;
    expect(pageChunk.content.endsWith('[truncated]')).toBe(true);
    expect(pageChunk.content.length).toBeLessThanOrEqual(12_000 + '\n[truncated]'.length);
  });

  it('all chunks: aclSubjects with notion-page-tree:rootPageId; shared parentExternalId', async () => {
    const blocks = [{ blockId: 'b0', type: 'paragraph', text: 'a' }];
    const chunks = await notionPageChunker.chunk(basePage(blocks), ctx);
    for (const c of chunks) {
      expect(c.aclSubjects).toEqual(['org:org-1', 'notion-page-tree:root-1']);
      expect(c.parentExternalId).toBe('notion-page:page-1');
    }
  });
});
