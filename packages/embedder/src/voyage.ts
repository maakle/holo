import { VoyageAIClient } from 'voyageai';
import type { Embedder } from './contract';
import { chunkArray } from './shared/chunk-array';
import { withBackoff } from './shared/backoff';

export interface CreateVoyageEmbedderOptions {
  apiKey: string;
  /** Optional sleep injection for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export function createVoyageEmbedder(opts: CreateVoyageEmbedderOptions): Embedder {
  // Pass maxRetries: 0 per-call so the SDK's built-in retry is disabled;
  // withBackoff handles our own retry logic.
  const client = new VoyageAIClient({ apiKey: opts.apiKey });
  return {
    model: 'voyage-code-3',
    dimensions: 1024,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (const batch of chunkArray(texts, 128)) {
        const res = await withBackoff(
          () =>
            client.embed(
              {
                input: batch,
                model: 'voyage-code-3',
              },
              { maxRetries: 0 },
            ),
          { upstream: 'voyage', sleep: opts.sleep },
        );
        out.push(...(res.data ?? []).map((d) => d.embedding ?? []));
      }
      return out;
    },
  };
}
