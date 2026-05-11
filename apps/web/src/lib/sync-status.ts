import { schema } from '@holo/db';
import { sql } from 'drizzle-orm';
import type { getServerContext } from './server-context';

type Db = Awaited<ReturnType<typeof getServerContext>>['db'];

export type LatestSyncStatus = {
  provider: string;
  sourceId: string;
  status: 'ok' | 'failed' | 'stalled' | 'cancelled';
  finishedAt: Date;
};

/**
 * For each (source, queue) pair, return the latest *finished* row in
 * `sync_runs` (status in {ok, failed, stalled, cancelled} — i.e. anything
 * with a non-null `finished_at`). Running rows are skipped so an in-progress
 * retry doesn't mask the prior failure.
 *
 * Distinct per queue (not just per source) because a provider can have
 * multiple queues that share one source row — github's `code` and `prose`
 * both run against the same `sources.id`. Collapsing to one row per source
 * would let a healthy prose run mask a failing code run.
 *
 * Uses Postgres' `DISTINCT ON` to keep this to a single round trip even when
 * the org has many sources with long run histories.
 */
export async function loadLatestSyncStatusByProvider(
  db: Db,
  orgId: string,
): Promise<Map<string, LatestSyncStatus>> {
  // `db.execute(sql`...`)` bypasses Drizzle's column-level type mapping, so
  // postgres-js hands `finished_at` back as a raw ISO string instead of a
  // Date. Type it accurately and coerce below.
  type Row = {
    source_id: string;
    provider: string;
    status: LatestSyncStatus['status'];
    finished_at: Date | string;
  };
  const result = await db.execute<Row>(sql`
    SELECT DISTINCT ON (source_id, queue_name)
           source_id, provider, status, finished_at
      FROM ${schema.syncRuns}
     WHERE organization_id = ${orgId}
       AND finished_at IS NOT NULL
     ORDER BY source_id, queue_name, finished_at DESC
  `);
  // Drizzle's `execute` return shape differs by driver: postgres-js returns
  // an array-like directly; node-postgres returns `{ rows: T[] }`. The rest
  // of the codebase normalizes with this unwrap (see agent-tools/get-*.ts,
  // retrieval-core/search.ts) — match it here so the helper survives either.
  const rows: Row[] =
    (result as unknown as { rows?: Row[] }).rows ??
    (result as unknown as Row[]) ??
    [];

  // For a given provider an org may have multiple sources (rare today, but
  // possible). We keep the most-recent failed run if there is one — a single
  // failing source is enough to flag the connector — otherwise the most
  // recent finished run wins.
  const byProvider = new Map<string, LatestSyncStatus>();
  for (const r of rows) {
    const entry: LatestSyncStatus = {
      provider: r.provider,
      sourceId: r.source_id,
      status: r.status,
      finishedAt: r.finished_at instanceof Date ? r.finished_at : new Date(r.finished_at),
    };
    const existing = byProvider.get(entry.provider);
    if (!existing) {
      byProvider.set(entry.provider, entry);
      continue;
    }
    const existingIsHealthy = existing.status === 'ok';
    const incomingIsBad = entry.status !== 'ok';
    if (existingIsHealthy && incomingIsBad) {
      byProvider.set(entry.provider, entry);
    } else if (entry.finishedAt > existing.finishedAt && existing.status === entry.status) {
      byProvider.set(entry.provider, entry);
    }
  }
  return byProvider;
}
