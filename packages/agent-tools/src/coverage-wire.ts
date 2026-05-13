/**
 * Wire-format (snake_case) projection of `SearchCoverage`. Used by REST
 * `/v1/search` and MCP `search` tool output. Internal TS APIs (e.g. the
 * chat orchestrator's `ChatAgentLoopResult.coverage`) keep the camelCase
 * `SearchCoverage` from `@holo/retrieval-core` unchanged.
 */
import type { SearchCoverage, SearchCoveragePass } from '@holo/retrieval-core';

export interface WireSearchCoveragePass {
  role: 'primary' | 'fallback';
  embedding_model: string;
  branch_counts: {
    vector_returned: number;
    bm25_returned: number;
    fused_returned: number;
  };
  timings_ms: number;
}

export interface WireSearchCoverage {
  query: string;
  filters: {
    provider: string | null;
    account_ids: string[] | null;
    user_subjects_count: number;
    top_k: number;
  };
  passes: WireSearchCoveragePass[];
  fallback_used: boolean;
  total_returned: number;
  total_timings_ms: number;
}

function passToWire(p: SearchCoveragePass): WireSearchCoveragePass {
  return {
    role: p.role,
    embedding_model: p.embeddingModel,
    branch_counts: {
      vector_returned: p.branchCounts.vectorReturned,
      bm25_returned: p.branchCounts.bm25Returned,
      fused_returned: p.branchCounts.fusedReturned,
    },
    timings_ms: p.timingsMs,
  };
}

export function coverageToWire(c: SearchCoverage): WireSearchCoverage {
  return {
    query: c.query,
    filters: {
      provider: c.filters.provider,
      account_ids: c.filters.accountIds === null ? null : [...c.filters.accountIds],
      user_subjects_count: c.filters.userSubjectsCount,
      top_k: c.filters.topK,
    },
    passes: c.passes.map(passToWire),
    fallback_used: c.fallbackUsed,
    total_returned: c.totalReturned,
    total_timings_ms: c.totalTimingsMs,
  };
}
