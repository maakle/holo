import type { Sql } from 'postgres';
import type {
  BackfillStore,
  ChunkToBackfill,
} from './embed-backfill-runner';

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}

/**
 * Postgres-backed BackfillStore. Reads chunks still tagged
 * `openai-3-large` and writes back the new `-small` vectors.
 */
export function createBackfillStore(sql: Sql): BackfillStore {
  return {
    async selectLegacyChunks(ids: string[]): Promise<ChunkToBackfill[]> {
      if (ids.length === 0) return [];
      const rows = await sql<ChunkToBackfill[]>`
        SELECT id, content
        FROM chunks
        WHERE id = ANY(${ids}::uuid[])
          AND embedding_model = 'openai-3-large'
      `;
      return rows;
    },

    async updateEmbeddings(rows): Promise<void> {
      if (rows.length === 0) return;
      // One transaction wraps every UPDATE — partial application would
      // leave some rows on `-small` vectors with `-large` tags (or vice
      // versa) and break retrieval until the next backfill swept them.
      await sql.begin(async (tx) => {
        for (const r of rows) {
          await tx`
            UPDATE chunks
            SET embedding = ${toPgVector(r.embedding)}::vector(1024),
                embedding_model = 'openai-3-small'
            WHERE id = ${r.id}
              AND embedding_model = 'openai-3-large'
          `;
        }
      });
    },
  };
}

/**
 * Pulls the next batch of legacy chunk ids to enqueue. Newest-first so
 * the most-queried recent content recovers retrieval before the long
 * tail. Returns `[]` when the backfill is complete.
 */
export async function selectNextLegacyBatch(
  sql: Sql,
  batchSize: number,
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM chunks
    WHERE embedding_model = 'openai-3-large'
    ORDER BY updated_at DESC
    LIMIT ${batchSize}
  `;
  return rows.map((r) => r.id);
}

/** Total remaining legacy chunks — used by the boot scanner for logging. */
export async function countLegacyChunks(sql: Sql): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT COUNT(*)::text AS n
    FROM chunks
    WHERE embedding_model = 'openai-3-large'
  `;
  return Number(rows[0]?.n ?? 0);
}
