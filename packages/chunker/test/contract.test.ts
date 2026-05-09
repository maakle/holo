import { describe, it, expectTypeOf } from 'vitest';
import type { Chunker, Chunk, ChunkContext, TreeSitterRegistry } from '../src/contract';

describe('Chunker contract', () => {
  it('Chunker<TInput> has kind, embeddingModel, chunk(input, ctx)', () => {
    expectTypeOf<Chunker<{ x: number }>>().toMatchTypeOf<{
      readonly kind: string;
      readonly embeddingModel: 'openai-3-small' | 'voyage-code-3';
      chunk(input: { x: number }, ctx: ChunkContext): Promise<Chunk[]>;
    }>();
  });

  it('Chunk shape', () => {
    expectTypeOf<Chunk>().toMatchTypeOf<{
      content: string;
      parentExternalId?: string;
      metadata: Record<string, unknown>;
      aclSubjects: string[];
    }>();
  });

  it('ChunkContext shape', () => {
    expectTypeOf<ChunkContext>().toMatchTypeOf<{
      organizationId: string;
      sourceId: string;
      sourceArtifactId: string;
      treeSitter?: TreeSitterRegistry;
    }>();
  });
});
