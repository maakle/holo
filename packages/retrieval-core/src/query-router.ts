import {
  createOpenAiEmbedder,
  createVoyageEmbedder,
  resolveOpenAiModel,
  type Embedder,
} from '@holo/embedder';
import { holoError, ErrorCode } from '@holo/errors';

/**
 * Models we may query with. `openai-3-large` is retained as a legacy read
 * tag for chunks embedded before the migration in PR #128 — new queries
 * default to `openai-3-small` (see `embedQuery`). Once the backfill (PR
 * #129) drops chunks tagged `openai-3-large` to zero, the legacy tag can
 * be removed from this union.
 */
export type EmbeddingModel = 'openai-3-small' | 'openai-3-large' | 'voyage-code-3';

export interface EmbedQueryResult {
  embedding: number[];
  model: EmbeddingModel;
}

const CODE_KEYWORDS = /\b(class|function|def|import|from|return|interface)\b/;
const CODE_PUNCT = /[(){};=].{3,}/;

export function looksLikeCode(q: string): boolean {
  return CODE_KEYWORDS.test(q) || CODE_PUNCT.test(q);
}

let cachedOpenai: Embedder | undefined;
let cachedVoyage: Embedder | undefined;

function getOpenai(): Embedder {
  if (cachedOpenai) return cachedOpenai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw holoError({ code: ErrorCode.HOLO_ENV_INVALID, problem: 'OPENAI_API_KEY is not set', fix: 'Set the OPENAI_API_KEY environment variable.' });
  const e = createOpenAiEmbedder({ apiKey });
  cachedOpenai = e;
  return e;
}

function getVoyage(): Embedder {
  if (cachedVoyage) return cachedVoyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw holoError({ code: ErrorCode.HOLO_ENV_INVALID, problem: 'VOYAGE_API_KEY is not set', fix: 'Set the VOYAGE_API_KEY environment variable.' });
  const e = createVoyageEmbedder({ apiKey });
  cachedVoyage = e;
  return e;
}

/** Reset cached embedder instances. Used in tests to swap implementations. */
export function _resetEmbedders(): void {
  cachedOpenai = undefined;
  cachedVoyage = undefined;
}

/** Inject embedder instances (test-only). */
export function _setEmbedders(opts: { openai?: Embedder; voyage?: Embedder }): void {
  if (opts.openai) cachedOpenai = opts.openai;
  if (opts.voyage) cachedVoyage = opts.voyage;
}

export async function embedQueryWith(
  q: string,
  model: EmbeddingModel,
): Promise<EmbedQueryResult> {
  const embedder = model === 'voyage-code-3' ? getVoyage() : getOpenai();
  const [embedding] = await embedder.embed([q]);
  if (!embedding) throw holoError({ code: ErrorCode.HOLO_FETCH_FAILED, problem: 'Embedder returned no vector for the query', fix: 'Check the embedder API response and retry.' });
  return { embedding, model };
}

export async function embedQuery(q: string): Promise<EmbedQueryResult> {
  // Match the query model to whatever the worker is currently writing
  // (`OPENAI_EMBEDDING_MODEL`). search.ts filters chunks by their
  // stored model tag, so a mismatch makes the corpus invisible.
  return embedQueryWith(
    q,
    looksLikeCode(q) ? 'voyage-code-3' : resolveOpenAiModel().tag,
  );
}
