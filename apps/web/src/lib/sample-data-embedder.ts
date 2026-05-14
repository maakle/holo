import 'server-only';
import { createOpenAiEmbedder } from '@holo/embedder';
import type { EmbedSampleChunksFn } from '@holo/db';

/**
 * Construct the embed callback `ensureSampleData` uses to vectorize the
 * Star Wars sample chunks. Returns `undefined` when `OPENAI_API_KEY` is
 * missing — callers should still call `ensureSampleData` in that case
 * (chunks land with NULL embedding and BM25 alone services them), since
 * the install path is also idempotent ACL backfill that matters even
 * without vectors.
 *
 * Sample artifacts are all prose (`doc` / `message` / `issue`) so we
 * only need the OpenAI tier — no code-kind chunks, no Voyage. The model
 * tag is propagated so chunks.embedding_model matches the operator's
 * currently-selected OpenAI tier and search.ts' model filter accepts
 * them.
 */
export function buildSampleEmbedFn(): EmbedSampleChunksFn | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const embedder = createOpenAiEmbedder({ apiKey });
  return async (texts) => {
    const vectors = await embedder.embed(texts);
    return { vectors, model: embedder.model };
  };
}
