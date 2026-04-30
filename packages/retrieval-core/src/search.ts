import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { embedQuery, embedQueryWith, type EmbeddingModel } from './query-router.js';

export interface SearchInput {
  db: DB;
  organizationId: string;
  q: string;
  topK?: number;
  provider?: 'github' | 'slack' | 'notion';
  userSubjects?: string[];
}

export interface SearchResult {
  chunkId: string;
  content: string;
  score: number;
  source: {
    provider: string;
    artifactKind: string;
    metadata: Record<string, unknown>;
  };
  snippetUrl?: string;
}

const MIN_RESULTS_BEFORE_FALLBACK = 5;
const RRF_K = 60;

function formatTextArray(values: string[]): string {
  // Postgres text[] literal: '{"a","b"}'. Quote each value and escape \\ and ".
  const escaped = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
}

interface ChunkRow {
  id: string;
  content: string;
  provider: string;
  source_artifact_id: string;
  metadata: Record<string, unknown> | null;
  rrf_score: number;
}

async function searchOnce(
  input: SearchInput & { embedding: number[]; model: EmbeddingModel; topK: number; userSubjects: string[] },
): Promise<SearchResult[]> {
  const provider = input.provider ?? null;

  // Verbatim hybrid SQL CTE per spec — RRF constant 60, LIMIT 100 per branch.
  // pgvector accepts vector literals as JSON-style strings cast to vector.
  const vectorLiteral = `[${input.embedding.join(',')}]`;

  const result = await input.db.execute<ChunkRow & Record<string, unknown>>(sql`
    WITH
      query_vec AS (SELECT ${vectorLiteral}::vector(1024) AS v),
      vector_ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> (SELECT v FROM query_vec)) AS rank
        FROM chunks
        WHERE organization_id = ${input.organizationId}
          AND embedding_model = ${input.model}
          AND acl_subjects && ${formatTextArray(input.userSubjects)}::text[]
          AND (${provider}::text IS NULL OR provider = ${provider})
        ORDER BY embedding <=> (SELECT v FROM query_vec)
        LIMIT 100
      ),
      bm25_ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          ORDER BY ts_rank(content_tsvector, plainto_tsquery('english', ${input.q})) DESC
        ) AS rank
        FROM chunks
        WHERE organization_id = ${input.organizationId}
          AND content_tsvector @@ plainto_tsquery('english', ${input.q})
          AND acl_subjects && ${formatTextArray(input.userSubjects)}::text[]
          AND (${provider}::text IS NULL OR provider = ${provider})
        ORDER BY ts_rank(content_tsvector, plainto_tsquery('english', ${input.q})) DESC
        LIMIT 100
      ),
      fused AS (
        SELECT id, SUM(1.0 / (${RRF_K} + rank)) AS rrf_score
        FROM (
          SELECT id, rank FROM vector_ranked
          UNION ALL
          SELECT id, rank FROM bm25_ranked
        ) t
        GROUP BY id
        ORDER BY rrf_score DESC
        LIMIT ${input.topK}
      )
    SELECT c.id, c.content, c.provider, c.source_artifact_id, c.metadata, f.rrf_score
    FROM fused f JOIN chunks c ON c.id = f.id
    ORDER BY f.rrf_score DESC
  `);

  const rows = ((result as unknown as { rows?: ChunkRow[] }).rows
    ?? (result as unknown as ChunkRow[])) ?? [];

  return rows.map((r) => {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    const artifactKind = String(metadata['artifact_kind'] ?? metadata['kind'] ?? '');
    const snippetUrl =
      typeof metadata['url'] === 'string'
        ? (metadata['url'] as string)
        : typeof metadata['permalink'] === 'string'
          ? (metadata['permalink'] as string)
          : undefined;
    return {
      chunkId: r.id,
      content: r.content,
      score: Number(r.rrf_score),
      source: {
        provider: r.provider,
        artifactKind,
        metadata,
      },
      ...(snippetUrl !== undefined ? { snippetUrl } : {}),
    };
  });
}

function rrfFuse(sets: SearchResult[][], topK: number): SearchResult[] {
  // JS-side RRF fusion across multiple result sets with constant k = RRF_K.
  const scoreById = new Map<string, { score: number; result: SearchResult }>();
  for (const set of sets) {
    set.forEach((result, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = scoreById.get(result.chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        scoreById.set(result.chunkId, { score: contribution, result });
      }
    });
  }
  return [...scoreById.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, result }) => ({ ...result, score }));
}

export async function search(input: SearchInput): Promise<SearchResult[]> {
  const topK = input.topK ?? 10;
  const userSubjects = input.userSubjects ?? [`org:${input.organizationId}`];

  const primary = await embedQuery(input.q);
  const firstResults = await searchOnce({
    ...input,
    embedding: primary.embedding,
    model: primary.model,
    topK,
    userSubjects,
  });

  if (firstResults.length >= MIN_RESULTS_BEFORE_FALLBACK) {
    return firstResults;
  }

  // Dual-model fallback: try the OTHER model and merge via RRF.
  const otherModel: EmbeddingModel =
    primary.model === 'voyage-code-3' ? 'openai-3-large' : 'voyage-code-3';
  let secondaryResults: SearchResult[] = [];
  try {
    const secondary = await embedQueryWith(input.q, otherModel);
    secondaryResults = await searchOnce({
      ...input,
      embedding: secondary.embedding,
      model: secondary.model,
      topK,
      userSubjects,
    });
  } catch {
    // If secondary embedder isn't configured (e.g., no Voyage key), just return primary.
    return firstResults;
  }

  return rrfFuse([firstResults, secondaryResults], topK);
}
