import OpenAI from 'openai';
import type { Embedder } from './contract';
import { chunkArray } from './shared/chunk-array';
import { withBackoff } from './shared/backoff';

export interface CreateOpenAiEmbedderOptions {
  apiKey: string;
  /** Optional sleep injection for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createOpenAiEmbedder(opts: CreateOpenAiEmbedderOptions): Embedder {
  // maxRetries: 0 disables the SDK's built-in retry; withBackoff handles our own.
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 0 });
  return {
    model: 'openai-3-large',
    dimensions: 1024,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (const batch of chunkArray(texts, 100)) {
        const res = await withBackoff(
          () =>
            client.embeddings.create({
              model: 'text-embedding-3-large',
              input: batch,
              dimensions: 1024,
              encoding_format: 'float',
            }),
          { upstream: 'openai', sleep: opts.sleep },
        );
        out.push(...res.data.map((d) => d.embedding));
      }
      return out;
    },
  };
}
