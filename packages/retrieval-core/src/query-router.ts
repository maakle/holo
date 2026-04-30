import {
  createOpenAiEmbedder,
  createVoyageEmbedder,
  type Embedder,
} from '@holo/embedder';

export type EmbeddingModel = 'openai-3-large' | 'voyage-code-3';

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
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const e = createOpenAiEmbedder({ apiKey });
  cachedOpenai = e;
  return e;
}

function getVoyage(): Embedder {
  if (cachedVoyage) return cachedVoyage;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');
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
  if (!embedding) throw new Error('Embedder returned no vector');
  return { embedding, model };
}

export async function embedQuery(q: string): Promise<EmbedQueryResult> {
  return embedQueryWith(q, looksLikeCode(q) ? 'voyage-code-3' : 'openai-3-large');
}
