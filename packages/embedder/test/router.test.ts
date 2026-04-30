import { describe, it, expect } from 'vitest';
import type { Embedder, EmbedderRegistry } from '../src/contract';
import {
  getEmbedderForChunkKind,
  embedChunks,
  type RouterChunk,
} from '../src/router';

function stubEmbedder(model: 'openai-3-large' | 'voyage-code-3', tag: number): Embedder {
  return {
    model,
    dimensions: 1024,
    async embed(texts: string[]) {
      return texts.map((_, i) =>
        Array.from({ length: 1024 }, (_, j) => tag * 1000 + i * 10 + j),
      );
    },
  };
}

const openai = stubEmbedder('openai-3-large', 1);
const voyage = stubEmbedder('voyage-code-3', 2);
const registry: EmbedderRegistry = { openai, voyage };

describe('getEmbedderForChunkKind', () => {
  it('routes github-code to voyage', () => {
    expect(getEmbedderForChunkKind('github-code', registry).model).toBe('voyage-code-3');
  });

  it('routes prose kinds to openai', () => {
    for (const kind of [
      'github-pr',
      'github-issue',
      'github-doc',
      'slack-thread',
      'notion-page',
    ]) {
      expect(getEmbedderForChunkKind(kind, registry).model).toBe('openai-3-large');
    }
  });

  it('defaults unknown kinds to openai', () => {
    expect(getEmbedderForChunkKind('unknown-kind', registry).model).toBe('openai-3-large');
  });
});

describe('embedChunks', () => {
  it('preserves input order across heterogeneous kinds', async () => {
    const chunks: RouterChunk[] = [
      { kind: 'github-code', content: 'code1' },
      { kind: 'github-pr', content: 'pr1' },
      { kind: 'github-code', content: 'code2' },
      { kind: 'slack-thread', content: 'thread1' },
    ];
    const out = await embedChunks(chunks, registry);
    expect(out).toHaveLength(4);
    expect(out[0]!.embeddingModel).toBe('voyage-code-3');
    expect(out[1]!.embeddingModel).toBe('openai-3-large');
    expect(out[2]!.embeddingModel).toBe('voyage-code-3');
    expect(out[3]!.embeddingModel).toBe('openai-3-large');
    expect(out[0]!.chunk.content).toBe('code1');
    expect(out[1]!.chunk.content).toBe('pr1');
    expect(out[2]!.chunk.content).toBe('code2');
    expect(out[3]!.chunk.content).toBe('thread1');
  });

  it('returns embedding vectors of length 1024', async () => {
    const chunks: RouterChunk[] = [
      { kind: 'github-pr', content: 'a' },
      { kind: 'github-code', content: 'b' },
    ];
    const out = await embedChunks(chunks, registry);
    expect(out[0]!.embedding).toHaveLength(1024);
    expect(out[1]!.embedding).toHaveLength(1024);
  });

  it('returns empty array on empty input', async () => {
    expect(await embedChunks([], registry)).toEqual([]);
  });
});
