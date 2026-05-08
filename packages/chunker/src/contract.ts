import type { TreeSitterRegistry } from './tree-sitter/registry';

export type { TreeSitterRegistry };

export interface Chunker<TInput> {
  readonly kind: string;
  readonly embeddingModel: 'openai-3-large' | 'voyage-code-3';
  chunk(input: TInput, ctx: ChunkContext): Promise<Chunk[]>;
}

export interface Chunk {
  content: string;
  parentExternalId?: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
}

export interface ChunkContext {
  organizationId: string;
  sourceId: string;
  sourceArtifactId: string;
  treeSitter?: TreeSitterRegistry;
}
