// Persists every sync attempt to the `sync_runs` table so the dashboard can
// show history that survives Redis flushes. Used exclusively by
// SyncProcessorBase — every connector flows through there.
import type { Sql } from 'postgres';
import { HoloError } from '@holo/errors';
import type { QueueName, SyncJobPayload } from './types';

export type RunStatus = 'running' | 'ok' | 'failed' | 'stalled';

export interface StartRunArgs {
  queueName: QueueName;
  jobId: string;
  payload: SyncJobPayload;
}

// Map queue name → provider tag for fast org+provider history queries.
// github has two queues (code+prose) that both belong to the same provider.
function providerForQueue(queue: QueueName): string {
  if (queue === 'github-code-sync' || queue === 'github-prose-sync') return 'github';
  // 'slack-sync' → 'slack', etc.
  return queue.replace(/-sync$/, '');
}

export async function startSyncRun(sql: Sql, args: StartRunArgs): Promise<void> {
  const provider = providerForQueue(args.queueName);
  await sql`
    INSERT INTO sync_runs (
      organization_id, source_id, provider, queue_name, job_id, status
    ) VALUES (
      ${args.payload.organizationId},
      ${args.payload.sourceId},
      ${provider},
      ${args.queueName},
      ${args.jobId},
      'running'
    )
    -- Same (queue, job) can re-enter on BullMQ retry; reset the prior row
    -- to a fresh attempt rather than failing the unique index.
    ON CONFLICT (queue_name, job_id) DO UPDATE SET
      status = 'running',
      started_at = now(),
      finished_at = NULL,
      duration_ms = NULL,
      artifact_count = NULL,
      error_code = NULL,
      error_problem = NULL,
      error_cause = NULL
  `;
}

export interface FinishOkArgs {
  queueName: QueueName;
  jobId: string;
  artifactCount: number;
}

export async function finishSyncRunOk(sql: Sql, args: FinishOkArgs): Promise<void> {
  await sql`
    UPDATE sync_runs
       SET status = 'ok',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int,
           artifact_count = ${args.artifactCount}
     WHERE queue_name = ${args.queueName} AND job_id = ${args.jobId}
  `;
}

export interface FinishFailArgs {
  queueName: QueueName;
  jobId: string;
  error: unknown;
}

export async function finishSyncRunFailed(sql: Sql, args: FinishFailArgs): Promise<void> {
  const { code, problem, cause } = describeError(args.error);
  await sql`
    UPDATE sync_runs
       SET status = 'failed',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int,
           error_code = ${code},
           error_problem = ${problem},
           error_cause = ${cause}
     WHERE queue_name = ${args.queueName} AND job_id = ${args.jobId}
  `;
}

// Boot-time sweep. If the worker died mid-job (BullMQ stall, crash, OOM,
// laptop sleep), the row is left in 'running' indefinitely. A crashed
// worker can't update its own row, so we age them out on next boot.
//
// 30 minutes is a deliberate floor — long enough that a healthy long-running
// sync (prose backfill) won't get reaped, short enough that a dead worker's
// rows don't poison the UI for hours.
export async function reconcileOrphanedRuns(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE sync_runs
       SET status = 'stalled',
           finished_at = now(),
           duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int,
           error_problem = 'worker did not report completion (likely crashed or stalled)'
     WHERE status = 'running'
       AND started_at < now() - INTERVAL '30 minutes'
     RETURNING id
  `;
  return rows.length;
}

function describeError(err: unknown): {
  code: string | null;
  problem: string;
  cause: string | null;
} {
  if (err instanceof HoloError) {
    return {
      code: err.code,
      problem: err.problem,
      cause: err.cause ?? null,
    };
  }
  const e = err as Error & { cause?: unknown };
  return {
    code: null,
    problem: String(e?.message ?? err).slice(0, 1000),
    cause: e?.cause ? String((e.cause as Error)?.message ?? e.cause).slice(0, 1000) : null,
  };
}
