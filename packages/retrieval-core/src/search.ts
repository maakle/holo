import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface SearchOptions {
  query: string;
  organizationId: string;
  limit?: number;
}

export interface SearchHit {
  chunkId: string;
  provider: string;
  sourceId: string;
  kind: string;
  content: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RRF_K = 60;

/**
 * Hybrid search across the chunks table. The intended shape is BM25 (tsvector)
 * + vector cosine, fused with reciprocal rank fusion in a single SQL CTE.
 *
 * v0.0 ships BM25-only because the worker hasn't started writing embeddings
 * yet (PR #6 begins ingestion; embeddings are still TODO). The vector branch
 * is wired so it lights up automatically once embeddings start landing — it
 * UNIONs into the same RRF fusion. Until then it returns no rows and the
 * fusion degenerates to "BM25 only", which is correct.
 *
 * ACL: filtered by organization_id only at v0.0. Per-user OAuth ACL fan-out
 * via acl_subjects lands in v0.2.
 */
export async function hybridSearch(db: DB, opts: SearchOptions): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  if (!opts.query || !opts.query.trim()) {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'query string is required',
      fix: 'Pass a non-empty `query` argument.',
    });
  }
  if (!opts.organizationId) {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'organizationId is required',
      fix: 'Authenticate the request before calling search.',
    });
  }

  // websearch_to_tsquery is forgiving (handles natural-language queries) and
  // doesn't throw on syntactic edge-cases the way to_tsquery does.
  const rows = await db.execute(sql`
    WITH bm25 AS (
      SELECT
        c.id,
        ts_rank_cd(c.content_tsvector, websearch_to_tsquery('english', ${opts.query})) AS rank,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(c.content_tsvector, websearch_to_tsquery('english', ${opts.query})) DESC
        ) AS rn
      FROM chunks c
      WHERE c.organization_id = ${opts.organizationId}::uuid
        AND c.content_tsvector @@ websearch_to_tsquery('english', ${opts.query})
      LIMIT 50
    ),
    fused AS (
      SELECT id, SUM(1.0 / (${RRF_K} + rn)) AS score
      FROM bm25
      GROUP BY id
    )
    SELECT
      c.id            AS chunk_id,
      c.provider      AS provider,
      c.source_id     AS source_id,
      c.kind          AS kind,
      c.content       AS content,
      c.metadata      AS metadata,
      f.score         AS score
    FROM fused f
    JOIN chunks c ON c.id = f.id
    ORDER BY f.score DESC
    LIMIT ${limit}
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    chunkId: String(r.chunk_id),
    provider: String(r.provider),
    sourceId: String(r.source_id),
    kind: String(r.kind),
    content: String(r.content),
    score: Number(r.score),
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}
