/**
 * Model tags. `openai-3-small` is the current-generation OpenAI embedder
 * (~6.5× cheaper than `-large` per token, very small recall delta in
 * practice); `openai-3-large` is retained as a *read* tag for chunks
 * embedded before the migration in PR #128. New embedders only ever
 * announce `openai-3-small` or `voyage-code-3`.
 */
export type EmbeddingModelRead = 'openai-3-small' | 'openai-3-large' | 'voyage-code-3';
export type EmbeddingModelWrite = 'openai-3-small' | 'voyage-code-3';

export interface Embedder {
  readonly model: EmbeddingModelWrite;
  readonly dimensions: 1024;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbedderRegistry = {
  openai: Embedder;
  voyage: Embedder;
};
