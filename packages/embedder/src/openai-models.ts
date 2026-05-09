import { holoError, ErrorCode } from '@holo/errors';
import type { EmbeddingModelWrite } from './contract';

/**
 * The set of OpenAI embedding API models Holo can run against. Adding a
 * new entry is the only thing required to support a future model:
 *   - the `tag` is what gets stored in `chunks.embedding_model` (and
 *     queried via `EmbeddingModel`).
 *   - the `dimensions` MUST stay 1024 because the schema's
 *     `vector(1024)` column locks the index dimensionality. Different
 *     dimensions need a separate column + migration, not just a config
 *     flip.
 *
 * Operators choose which one to run via the `OPENAI_EMBEDDING_MODEL`
 * env var (default `text-embedding-3-small`). Per-customer model
 * selection is intentionally out of scope: switching mid-flight
 * requires a per-org backfill, and Holo's hybrid retrieval (BM25 + RRF)
 * means the marginal vector quality between OpenAI tiers rarely
 * justifies the operational cost.
 */
export const OPENAI_MODELS = {
  'text-embedding-3-small': {
    tag: 'openai-3-small',
    dimensions: 1024,
  },
  'text-embedding-3-large': {
    tag: 'openai-3-large',
    dimensions: 1024,
  },
} as const satisfies Record<string, { tag: EmbeddingModelWrite; dimensions: 1024 }>;

export type OpenAiApiModel = keyof typeof OPENAI_MODELS;

export interface ResolvedOpenAiModel {
  /** What goes on the wire to the OpenAI /embeddings endpoint. */
  api: OpenAiApiModel;
  /** What gets stored in `chunks.embedding_model` (and matched in queries). */
  tag: EmbeddingModelWrite;
  dimensions: 1024;
}

const DEFAULT_OPENAI_MODEL: OpenAiApiModel = 'text-embedding-3-small';

function isSupportedModel(value: string): value is OpenAiApiModel {
  return value in OPENAI_MODELS;
}

/**
 * Resolve the OpenAI embedding model from `OPENAI_EMBEDDING_MODEL`,
 * with the default and validation centralised. Throws a Holo error
 * (not a generic Error) so misconfiguration shows up as a clear setup
 * problem at boot, not a confusing OpenAI 4xx mid-sync.
 *
 * Reads `process.env` lazily on every call rather than caching, because
 * tests inject env values per-case via `vi.stubEnv` and a cached
 * resolution would fix the model at module load time.
 */
export function resolveOpenAiModel(): ResolvedOpenAiModel {
  const raw = process.env.OPENAI_EMBEDDING_MODEL;
  if (!raw || raw.length === 0) {
    const cfg = OPENAI_MODELS[DEFAULT_OPENAI_MODEL];
    return { api: DEFAULT_OPENAI_MODEL, tag: cfg.tag, dimensions: cfg.dimensions };
  }
  if (!isSupportedModel(raw)) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: `OPENAI_EMBEDDING_MODEL='${raw}' is not supported`,
      fix: `Set OPENAI_EMBEDDING_MODEL to one of: ${Object.keys(OPENAI_MODELS).join(', ')}.`,
    });
  }
  const cfg = OPENAI_MODELS[raw];
  return { api: raw, tag: cfg.tag, dimensions: cfg.dimensions };
}
