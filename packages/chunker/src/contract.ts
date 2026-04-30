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

// Forward-declared — full implementation lands in Task 3.3.
export interface TreeSitterRegistry {
  parse(language: string, source: string): unknown;
}
