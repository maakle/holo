export interface Embedder {
  readonly model: 'openai-3-large' | 'voyage-code-3';
  readonly dimensions: 1024;
  embed(texts: string[]): Promise<number[][]>;
}

export type EmbedderRegistry = {
  openai: Embedder;
  voyage: Embedder;
};
