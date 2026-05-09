import type { Sql } from 'postgres';
import type {
  BackfillStore,
  ChunkToBackfill,
} from './embed-backfill-runner';
import type { EmbeddingModel } from './embed-insert';

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

/**
 * Postgres-backed BackfillStore. Reads chunks tagged `sourceModel` and
 * writes back vectors tagged `targetModel` (typically `openai-3-large`
 * → `openai-3-small`, but the same path handles any future migration
 * between OpenAI tiers).
 */
export function createBackfillStore(sql: Sql): BackfillStore {
  return {
    async selectChunksMatchingModel(ids, sourceModel): Promise<ChunkToBackfill[]> {
      if (ids.length === 0) return [];
      const rows = await sql<ChunkToBackfill[]>`
        SELECT id, content
        FROM chunks
        WHERE id = ANY(${ids}::uuid[])
          AND embedding_model = ${sourceModel}
      `;
      return rows;
    },

    async updateEmbeddings({ rows, sourceModel, targetModel }): Promise<void> {
      if (rows.length === 0) return;
      // One transaction wraps every UPDATE — partial application would
      // leave some rows on the new vectors with the old tag (or vice
      // versa) and break retrieval until the next backfill swept them.
      await sql.begin(async (tx) => {
        for (const r of rows) {
          await tx`
            UPDATE chunks
            SET embedding = ${toPgVector(r.embedding)}::vector(1024),
                embedding_model = ${targetModel}
            WHERE id = ${r.id}
              AND embedding_model = ${sourceModel}
          `;
        }
      });
    },
  };
}

/**
 * Pulls the next batch of chunk ids whose embedding model doesn't match
 * the operator's currently-selected target. Newest-first so the
 * most-queried recent content recovers retrieval before the long tail.
 */
export async function selectNextBatchForBackfill(
  sql: Sql,
  sourceModel: EmbeddingModel,
  batchSize: number,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM chunks
    WHERE embedding_model = ${sourceModel}
    ORDER BY updated_at DESC
    LIMIT ${batchSize}
  `;
  return rows.map((r) => r.id);
}

/** Total remaining chunks tagged `sourceModel`. Used by the boot scanner for logging. */
export async function countChunksMatchingModel(
  sql: Sql,
  sourceModel: EmbeddingModel,
): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n
    FROM chunks
    WHERE embedding_model = ${sourceModel}
  `;
  return Number(rows[0]?.n ?? 0);
}
