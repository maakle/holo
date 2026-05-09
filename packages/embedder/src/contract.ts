/**
 * Model tags Holo can store on `chunks.embedding_model`. Both OpenAI
 * tiers are valid write targets — operators pick one per deploy via
 * `OPENAI_EMBEDDING_MODEL` (see `resolveOpenAiModel` in
 * `./openai-models`). The default is `openai-3-small`; flipping to
 * `-large` requires re-running the backfill job to migrate existing
 * chunks.
 *
 * Read and Write are the same union now that both `-small` and `-large`
 * are first-class. Kept as separate aliases for self-documenting
 * call-site intent.
 */
export type EmbeddingModelRead = 'openai-3-small' | 'openai-3-large' | 'voyage-code-3';
export type EmbeddingModelWrite = EmbeddingModelRead;

export interface Embedder {
  readonly model: EmbeddingModelWrite;
  readonly dimensions: 1024;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbedderRegistry = {
  openai: Embedder;
  voyage: Embedder;
};
