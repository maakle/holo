# 0002 — Postgres-only hybrid search for v1

**Status:** Accepted · **Date:** 2026-04-29

## Context

Memex's primary read pattern is hybrid retrieval: vector similarity + lexical (BM25-ish) fused into a single ranked list, filtered by ACL subjects and source/time metadata. Options:

1. Postgres-only: `pgvector ≥ 0.8` + `tsvector` + `pg_trgm`, fused via Reciprocal Rank Fusion in a single SQL CTE.
2. Postgres + dedicated vector engine (Qdrant, Weaviate).
3. Dedicated full search engine (Vespa, Elasticsearch, OpenSearch).

## Decision

Option 1 for v1. Single Postgres deployment.

## Consequences

**Positive:**
- One database, one operational concern, one backup/restore story. Self-host story stays simple.
- pgvector ≥ 0.8 with iterative scan handles selective filters well; Tiger Data benchmarks pgvector + BM25 at 138M docs sub-second.
- Onyx Lite mode validates this exact architecture at production scale.
- Hybrid SQL+vector queries (filter + ACL + similarity) are one composable Drizzle query.
- ACL enforcement is a `WHERE` clause, not cross-system synchronization.

**Negative:**
- Per-tenant indexes >20M chunks with low-selectivity ACL filters can degrade. We're not there yet.
- Postgres `tsvector` is not true BM25. Good enough for v1; ParadeDB's `pg_search` is the upgrade.

**Mitigation:**
- Keep `chunks` and `embeddings` as separate tables so a future dual-write to Qdrant or Vespa is mechanical.
- Instrument retrieval p50/p95/p99 per workspace from day one.
- Document a ParadeDB swap path before considering a separate engine.
- Re-evaluate at ~50M chunks total or first p99 latency regression.
