import OpenAI from 'openai';
import type { Embedder } from './contract';
import { resolveOpenAiModel } from './openai-models';
import { chunkArray } from './shared/chunk-array';
import { withBackoff } from './shared/backoff';

export interface CreateOpenAiEmbedderOptions {
  apiKey: string;
  /**
   * Override the model that would otherwise come from
   * `OPENAI_EMBEDDING_MODEL`. Useful for tests, A/B workers, or
   * eval harnesses; production should rely on the env var.
   */
  model?: 'text-embedding-3-small' | 'text-embedding-3-large';
  /** Optional sleep injection for tests. */
  sleep?: (ms: number) => Promise<void>;
}

// Both supported OpenAI models accept up to 8192 tokens per input. Token
// density varies wildly: prose is ~4 chars/token, but code with single-char
// tokens (braces, operators, identifiers) can hit ~1.5 chars/token. We pick
// 12000 (≈ 1.5 chars/token × 8192 tokens) to stay safe for the densest code.
// Slightly less accurate embeddings on long files beat batch-killing 400s.
const OPENAI_EMBED_MAX_CHARS = 12000;

function truncateForOpenAi(text: string): string {
  return text.length > OPENAI_EMBED_MAX_CHARS
    ? text.slice(0, OPENAI_EMBED_MAX_CHARS)
    : text;
}

export function createOpenAiEmbedder(opts: CreateOpenAiEmbedderOptions): Embedder {
  // maxRetries: 0 disables the SDK's built-in retry; withBackoff handles our own.
  const client = new OpenAI({ apiKey: opts.apiKey, maxRetries: 0 });
  // Resolve once at construction. Every embedder instance corresponds to a
  // single API model — flipping the env mid-run requires a worker restart,
  // matching the existing operational model for embedder config.
  const resolved = opts.model
    ? { api: opts.model, tag: opts.model === 'text-embedding-3-large' ? 'openai-3-large' as const : 'openai-3-small' as const, dimensions: 1024 as const }
    : resolveOpenAiModel();
  return {
    model: resolved.tag,
    dimensions: resolved.dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      // Truncate any input that would exceed the 8192-token limit. Without
      // this a single oversized PR/issue body kills the whole batch with a
      // 400 from OpenAI ("maximum input length is 8192 tokens"), and BullMQ
      // retries the same batch indefinitely. Truncating produces a slightly
      // less accurate embedding for the long ones, but that's strictly
      // better than no embedding at all.
      const truncated = texts.map(truncateForOpenAi);
      const out: number[][] = [];
      for (const batch of chunkArray(truncated, 100)) {
        const res = await withBackoff(
          () =>
            client.embeddings.create({
              model: resolved.api,
              input: batch,
              dimensions: resolved.dimensions,
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
