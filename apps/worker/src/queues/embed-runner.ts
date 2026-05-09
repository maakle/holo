import type { Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
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

// Mapping from chunk.kind → embedding model. Mirrors the rule in
// packages/embedder/src/router.ts: `github-code` chunks go to voyage,
// everything else to openai. Kept local so the worker doesn't have a
// build-time dep on @holo/embedder.
export function modelForChunkKind(kind: string): EmbeddingModel {
  return kind === 'github-code' ? 'voyage-code-3' : 'openai-3-small';
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
  const perModel: Record<EmbeddingModel, number> = {
    'openai-3-small': 0,
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
  const groups = new Map<EmbeddingModel, ChunkInsertPayload[]>([
    ['openai-3-small', []],
    ['voyage-code-3', []],
  ]);
  for (const c of chunks) {
    const m = modelForChunkKind(c.kind);
    groups.get(m)!.push(c);
  }
  return groups;
}
