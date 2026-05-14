import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { resolveOpenAiModel } from '@holo/embedder';
import { holoError, ErrorCode } from '@holo/errors';
import { embedQuery, embedQueryWith, type EmbeddingModel } from './query-router';

export interface SearchInput {
  db: DB;
  organizationId: string;
  q: string;
  topK?: number;
  provider?: 'github' | 'slack' | 'notion' | 'grain' | 'pylon';
  userSubjects: string[];
  /**
   * Restrict results to chunks stamped with one of these `customer_accounts.id`s.
   * Pass a single id for "everything about Skello" lookups; pass an array for
   * "everything about my T0 accounts". Empty array is treated as no filter
   * (same as omitting the field) — distinguish "no filter" from "no matches"
   * at the call site.
   */
  accountId?: string | ReadonlyArray<string>;
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

/**
 * Telemetry returned alongside results so callers (chat orchestrator, REST
 * `/v1/search`) can show users *what was actually searched* — the questions
 * "did you check Slack?" and "is HubSpot up to date?" have answers in this
 * shape, not in the results list.
 *
 * Field semantics:
 * - `queries.vector.model` is the model the chunks were filtered by, not just
 *   the model used to embed the query — the search SQL gates on both.
 * - `branchCounts.vectorReturned` / `bm25Returned` count rows the SQL CTE
 *   returned per branch (capped at 100 by `LIMIT 100`); `fusedReturned` is
 *   after RRF fusion and `topK` truncation.
 * - `fallbackUsed` is true when the primary embedding model came back with
 *   fewer than `MIN_RESULTS_BEFORE_FALLBACK` results and we re-queried the
 *   other family (voyage ↔ openai). Both passes' counts are recorded in
 *   `passes`.
 * - `timingsMs` is per-pass wall-clock from the caller's perspective — embed
 *   + SQL together, since they're sequential and the split rarely matters.
 */
export interface SearchCoverage {
  query: string;
  filters: {
    provider: string | null;
    accountIds: ReadonlyArray<string> | null;
    userSubjectsCount: number;
    topK: number;
  };
  passes: ReadonlyArray<SearchCoveragePass>;
  fallbackUsed: boolean;
  totalReturned: number;
  totalTimingsMs: number;
}

export interface SearchCoveragePass {
  /** `'primary'` for the first embedding family tried; `'fallback'` for the
   * second when the primary returned too few results. */
  role: 'primary' | 'fallback';
  embeddingModel: EmbeddingModel;
  branchCounts: {
    vectorReturned: number;
    bm25Returned: number;
    fusedReturned: number;
  };
  timingsMs: number;
}

/** Envelope returned by `searchWithCoverage`. `search()` exposes only
 * `results` for callers that don't need telemetry. */
export interface SearchEnvelope {
  results: SearchResult[];
  coverage: SearchCoverage;
}

const MIN_RESULTS_BEFORE_FALLBACK = 5;
const RRF_K = 60;

function formatTextArray(values: string[]): string {
  // Postgres text[] literal: '{"a","b"}'. Quote each value and escape \\ and ".
  const escaped = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${escaped.join(',')}}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatUuidArray(values: ReadonlyArray<string>): string {
  // uuid[] literal: '{uuid,uuid}'. Validate each value to keep this filter
  // from leaking into a free-form string injection — the rest of the WHERE
  // clause is parameter-bound but this array is interpolated as a literal.
  for (const v of values) {
    if (!UUID_RE.test(v)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Invalid uuid in accountId filter: ${v}`,
        fix: 'Pass a valid customer_accounts.id from the caller.',
      });
    }
  }
  return `{${values.join(',')}}`;
}

function normalizeAccountIds(
  input: string | ReadonlyArray<string> | undefined,
): string[] | null {
  if (input === undefined) return null;
  if (typeof input === 'string') return [input];
  if (input.length === 0) return null; // empty array = no filter
  return [...input];
}

interface ChunkRow {
  id: string;
  content: string;
  provider: string;
  kind: string;
  source_artifact_id: string;
  metadata: Record<string, unknown> | null;
  rrf_score: number;
}

interface SearchOnceOutput {
  results: SearchResult[];
  branchCounts: SearchCoveragePass['branchCounts'];
}

async function searchOnce(
  input: SearchInput & { embedding: number[]; model: EmbeddingModel; topK: number; userSubjects: string[] },
): Promise<SearchOnceOutput> {
  const provider = input.provider ?? null;

  // Normalize accountId into a Postgres uuid[] literal. `null` here means "no
  // filter" — both branches accept that via `IS NULL OR account_id = ANY(...)`.
  const accountIds = normalizeAccountIds(input.accountId);
  const accountIdLiteral = accountIds === null ? null : formatUuidArray(accountIds);

  // Verbatim hybrid SQL CTE per spec — RRF constant 60, LIMIT 100 per branch.
  // pgvector accepts vector literals as JSON-style strings cast to vector.
  //
  // The coverage payload needs per-branch counts BEFORE fusion (so users can
  // tell "vector found 80 things, BM25 found 3" — a strong signal that the
  // query was semantically broad but had no keyword anchor). We capture them
  // by surfacing extra columns from the per-branch CTEs and reading them off
  // the first row.
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
          AND (${accountIdLiteral}::uuid[] IS NULL OR account_id = ANY(${accountIdLiteral}::uuid[]))
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
          AND (${accountIdLiteral}::uuid[] IS NULL OR account_id = ANY(${accountIdLiteral}::uuid[]))
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
      ),
      branch_counts AS (
        SELECT
          (SELECT COUNT(*)::int FROM vector_ranked) AS vector_total,
          (SELECT COUNT(*)::int FROM bm25_ranked) AS bm25_total
      )
    SELECT c.id, c.content, c.provider, c.kind, c.source_artifact_id, c.metadata, f.rrf_score,
           b.vector_total, b.bm25_total
    FROM fused f
    JOIN chunks c ON c.id = f.id
    CROSS JOIN branch_counts b
    ORDER BY f.rrf_score DESC
  `);

  const rows = ((result as unknown as { rows?: Array<ChunkRow & { vector_total: number | null; bm25_total: number | null }> }).rows
    ?? (result as unknown as Array<ChunkRow & { vector_total: number | null; bm25_total: number | null }>)) ?? [];

  // When the fused CTE returns zero rows the CROSS JOIN produces nothing, so
  // the branch counts have to be re-queried separately to stay non-null.
  let vectorTotal = rows[0]?.vector_total ?? 0;
  let bm25Total = rows[0]?.bm25_total ?? 0;
  if (rows.length === 0) {
    const fallback = await input.db.execute<{ vector_total: number; bm25_total: number }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM chunks
          WHERE organization_id = ${input.organizationId}
            AND embedding_model = ${input.model}
            AND acl_subjects && ${formatTextArray(input.userSubjects)}::text[]
            AND (${provider}::text IS NULL OR provider = ${provider})
            AND (${accountIdLiteral}::uuid[] IS NULL OR account_id = ANY(${accountIdLiteral}::uuid[]))
            AND embedding IS NOT NULL
          LIMIT 100
        ) AS vector_total,
        (SELECT COUNT(*)::int FROM chunks
          WHERE organization_id = ${input.organizationId}
            AND content_tsvector @@ plainto_tsquery('english', ${input.q})
            AND acl_subjects && ${formatTextArray(input.userSubjects)}::text[]
            AND (${provider}::text IS NULL OR provider = ${provider})
            AND (${accountIdLiteral}::uuid[] IS NULL OR account_id = ANY(${accountIdLiteral}::uuid[]))
          LIMIT 100
        ) AS bm25_total
    `);
    const counts = ((fallback as unknown as { rows?: Array<{ vector_total: number; bm25_total: number }> }).rows
      ?? (fallback as unknown as Array<{ vector_total: number; bm25_total: number }>)) ?? [];
    vectorTotal = counts[0]?.vector_total ?? 0;
    bm25Total = counts[0]?.bm25_total ?? 0;
  }

  const results = rows.map((r): SearchResult => {
    const metadata = (r.metadata ?? {}) as Record<string, unknown>;
    // Prefer the chunks.kind column over metadata.kind: chunkers store the
    // chunk's *role* (diff/review/title for github-pr, block/page for notion)
    // in metadata.kind, but URL/label builders need the *artifact* kind.
    // chunks.kind is namespaced as "<provider>-<kind>"; strip the prefix so
    // builders that check `kind === 'pr'`/`'doc'`/etc. match.
    const prefix = `${r.provider}-`;
    const rawKind = typeof r.kind === 'string' ? r.kind : '';
    const artifactKind = rawKind.startsWith(prefix)
      ? rawKind.slice(prefix.length)
      : rawKind || String(metadata['artifact_kind'] ?? metadata['kind'] ?? '');
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

  return {
    results,
    branchCounts: {
      vectorReturned: vectorTotal,
      bm25Returned: bm25Total,
      fusedReturned: results.length,
    },
  };
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

/**
 * Backwards-compatible thin wrapper around `searchWithCoverage` for callers
 * that don't need telemetry. New code should prefer `searchWithCoverage` so
 * users can see what was actually searched.
 */
export async function search(input: SearchInput): Promise<SearchResult[]> {
  const { results } = await searchWithCoverage(input);
  return results;
}

/**
 * Hybrid retrieval with attached coverage telemetry. The coverage payload
 * is the substrate for the "what I searched" footer surfaced by the chat
 * orchestrator and REST `/v1/search` — keep it cheap to compute and small
 * enough to ship in every response.
 */
export async function searchWithCoverage(input: SearchInput): Promise<SearchEnvelope> {
  const topK = input.topK ?? 10;
  const userSubjects = input.userSubjects;
  const t0 = Date.now();

  const passes: SearchCoveragePass[] = [];

  const primaryStart = Date.now();
  const primary = await embedQuery(input.q);
  const firstOut = await searchOnce({
    ...input,
    embedding: primary.embedding,
    model: primary.model,
    topK,
    userSubjects,
  });
  passes.push({
    role: 'primary',
    embeddingModel: primary.model,
    branchCounts: firstOut.branchCounts,
    timingsMs: Date.now() - primaryStart,
  });

  if (firstOut.results.length >= MIN_RESULTS_BEFORE_FALLBACK) {
    return {
      results: firstOut.results,
      coverage: buildCoverage({
        input,
        topK,
        passes,
        fallbackUsed: false,
        totalReturned: firstOut.results.length,
        totalTimingsMs: Date.now() - t0,
      }),
    };
  }

  // Dual-model fallback: try the OTHER family (voyage ↔ openai) and
  // merge via RRF. Chunks tagged with the *non-active* OpenAI tier
  // (e.g. an in-flight backfill leaving some rows on `openai-3-large`
  // while the operator has flipped to `-small`) are dark to this path
  // — search.ts filters by exact model tag and the cached OpenAI
  // embedder only produces vectors in the operator's selected tier.
  // They become searchable again as the embed-backfill job rewrites
  // them.
  const otherModel: EmbeddingModel =
    primary.model === 'voyage-code-3'
      ? resolveOpenAiModel().tag
      : 'voyage-code-3';
  let secondaryOut: SearchOnceOutput | null = null;
  const fallbackStart = Date.now();
  try {
    const secondary = await embedQueryWith(input.q, otherModel);
    secondaryOut = await searchOnce({
      ...input,
      embedding: secondary.embedding,
      model: secondary.model,
      topK,
      userSubjects,
    });
    passes.push({
      role: 'fallback',
      embeddingModel: secondary.model,
      branchCounts: secondaryOut.branchCounts,
      timingsMs: Date.now() - fallbackStart,
    });
  } catch {
    // If secondary embedder isn't configured (e.g., no Voyage key), just
    // return primary. Coverage records this as "no fallback attempted".
    return {
      results: firstOut.results,
      coverage: buildCoverage({
        input,
        topK,
        passes,
        fallbackUsed: false,
        totalReturned: firstOut.results.length,
        totalTimingsMs: Date.now() - t0,
      }),
    };
  }

  const fused = rrfFuse([firstOut.results, secondaryOut.results], topK);
  return {
    results: fused,
    coverage: buildCoverage({
      input,
      topK,
      passes,
      fallbackUsed: true,
      totalReturned: fused.length,
      totalTimingsMs: Date.now() - t0,
    }),
  };
}

function buildCoverage(args: {
  input: SearchInput;
  topK: number;
  passes: SearchCoveragePass[];
  fallbackUsed: boolean;
  totalReturned: number;
  totalTimingsMs: number;
}): SearchCoverage {
  const accountIds = normalizeAccountIds(args.input.accountId);
  return {
    query: args.input.q,
    filters: {
      provider: args.input.provider ?? null,
      accountIds,
      userSubjectsCount: args.input.userSubjects.length,
      topK: args.topK,
    },
    passes: args.passes,
    fallbackUsed: args.fallbackUsed,
    totalReturned: args.totalReturned,
    totalTimingsMs: args.totalTimingsMs,
  };
}
