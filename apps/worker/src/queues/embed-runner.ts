import type { Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { resolveOpenAiModel } from '@holo/embedder';
import {
  insertEmbeddedChunks,
  type ChunkInsertPayload,
  type EmbedJobPayload,
  type EmbeddedChunkRow,
  type EmbeddingModel,
} from './embed-insert';

export type InsertChunks = (rows: EmbeddedChunkRow[]) => Promise<number>;

// The embedder we depend on at runtime. Defined as a structural interface so
// the embed runner can be unit-tested without booting the real embedder
// package, and so the wiring can swap in a stub when the embedder package
// has not been built yet.
export interface EmbedderClient {
  embedBatch(model: EmbeddingModel, texts: string[]): Promise<number[][]>;
}

/**
 * Routes a chunk to its embedding model. Source-code chunks always go to
 * Voyage; everything else goes to whatever OpenAI tier the operator has
 * selected via `OPENAI_EMBEDDING_MODEL`. Mirrors the rule in
 * packages/embedder/src/router.ts (`CODE_CHUNK_KINDS`) — keep both in sync.
 * Kept local so the worker doesn't pull a build-time dep on the full
 * @holo/embedder runtime.
 *
 * The openai tag is read from env on every call rather than cached so
 * tests can flip the env var per-case via `vi.stubEnv`.
 */
const CODE_CHUNK_KINDS = new Set(['github-code', 'gitlab-code']);

export function modelForChunkKind(kind: string): EmbeddingModel {
  if (CODE_CHUNK_KINDS.has(kind)) return 'voyage-code-3';
  return resolveOpenAiModel().tag;
}

export type RunEmbedJobArgs = {
  payload: EmbedJobPayload;
  embedder: EmbedderClient;
  // Either provide a Sql (real postgres) — runner will use insertEmbeddedChunks —
  // or inject an insertChunks function directly (used in tests).
  sql?: Sql;
  insertChunks?: InsertChunks;
};

export type EmbedJobResult = {
  inserted: number;
  perModel: Record<EmbeddingModel, number>;
};

export async function runEmbedJob(args: RunEmbedJobArgs): Promise<EmbedJobResult> {
  const groups = groupByModel(args.payload.chunks);
  const all: EmbeddedChunkRow[] = [];
  // Initialise every possible tag to 0 so the log line is consistent
  // regardless of which OpenAI tier the operator has selected.
  const perModel: Record<EmbeddingModel, number> = {
    'openai-3-small': 0,
    'openai-3-large': 0,
    'voyage-code-3': 0,
  };

  for (const [model, chunks] of groups) {
    if (chunks.length === 0) continue;
    const vectors = await args.embedder.embedBatch(
      model,
      chunks.map((c) => c.content),
    );
    if (vectors.length !== chunks.length) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `embedder returned ${vectors.length} vectors for ${chunks.length} chunks (${model})`,
        fix: 'This is an embedder-side bug. Inspect the adapter for partial responses.',
      });
    }
    chunks.forEach((chunk, i) => {
      all.push({ chunk, embedding: vectors[i]!, embeddingModel: model });
    });
    perModel[model] += chunks.length;
  }

  const insert: InsertChunks = args.insertChunks
    ?? ((rows) => {
      if (!args.sql) {
        throw holoError({
          code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
          problem: 'runEmbedJob requires either sql or insertChunks',
          fix: 'Pass a postgres.Sql instance or an insertChunks override.',
        });
      }
      return insertEmbeddedChunks(args.sql, rows);
    });
  const inserted = await insert(all);
  return { inserted, perModel };
}

function groupByModel(chunks: ChunkInsertPayload[]): Map<EmbeddingModel, ChunkInsertPayload[]> {
  // Build the bucket on demand so we don't have to enumerate every
  // EmbeddingModel literal up front.
  const groups = new Map<EmbeddingModel, ChunkInsertPayload[]>();
  for (const c of chunks) {
    const m = modelForChunkKind(c.kind);
    let bucket = groups.get(m);
    if (!bucket) {
      bucket = [];
      groups.set(m, bucket);
    }
    bucket.push(c);
  }
  return groups;
}
