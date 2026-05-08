import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { createDb, type DB } from '@holo/db';
import { recordAgentEvent } from '@holo/audit';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { runSyncJob, type SyncResult } from './sync-dispatch';
import { getSyncRunner } from './sync-runner-registry';
import {
  createPostgresSyncCursorStore,
  type SyncCursorStore,
} from './sync-cursor-store';
import { createPostgresCheckpointStore, type CheckpointStore } from '../step';
import {
  startSyncRun,
  finishSyncRunOk,
  finishSyncRunFailed,
  updateSyncRunProgress,
} from './sync-runs-store';
import type { QueueName, SyncJobPayload } from './types';

let cachedSql: Sql | null = null;
let cachedDb: DB | null = null;
let cachedCursorStore: SyncCursorStore | null = null;
let cachedCheckpointStore: CheckpointStore | null = null;

function getSql(): Sql {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedSql = postgres(url, { max: 4, onnotice: () => {} });
  return cachedSql;
}

function getDb(): DB {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedDb = createDb(url);
  return cachedDb;
}

function providerForQueue(queue: QueueName): string {
  if (queue === 'github-code-sync') return 'github-code';
  if (queue === 'github-prose-sync') return 'github-prose';
  return queue.replace(/-sync$/, '');
}

function getCursorStore(): SyncCursorStore {
  cachedCursorStore ??= createPostgresSyncCursorStore(getSql());
  return cachedCursorStore;
}

function getCheckpointStore(): CheckpointStore {
  cachedCheckpointStore ??= createPostgresCheckpointStore(getSql());
  return cachedCheckpointStore;
}

// Test seam: lets tests swap in in-memory stores.
export function __setStoresForTests(args: {
  cursorStore?: SyncCursorStore;
  checkpointStore?: CheckpointStore;
  db?: DB;
}): void {
  if (args.cursorStore) cachedCursorStore = args.cursorStore;
  if (args.checkpointStore) cachedCheckpointStore = args.checkpointStore;
  if (args.db) cachedDb = args.db;
}

export abstract class SyncProcessorBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);
  protected abstract readonly queueName: QueueName;

  async process(job: Job<SyncJobPayload>): Promise<SyncResult> {
    const jobId = job.id ?? `unidentified-${Date.now()}`;
    const ctx = `sourceId=${job.data.sourceId} queue=${this.queueName} jobId=${jobId}`;
    const sql = getSql();
    const startedAtMs = Date.now();
    const provider = providerForQueue(this.queueName);
    // Best-effort run-history write. If the insert itself blows up (DB down,
    // FK violation against a deleted source), we'd rather still attempt the
    // sync than refuse to start — the BullMQ history is the fallback.
    try {
      await startSyncRun(sql, {
        queueName: this.queueName,
        jobId,
        payload: job.data,
      });
    } catch (err) {
      // FK violation on source_id means the source was deleted (user
      // disconnected) after this job was enqueued. There's nothing to sync —
      // bail without running the connector, otherwise we'd waste an API
      // round-trip and produce a misleading 'failed' run row. Anything else
      // we just warn about and try to sync anyway.
      const msg = (err as Error).message ?? '';
      const sourceGone = /sync_runs_source_id_fkey/.test(msg);
      if (sourceGone) {
        this.logger.log(
          `skipping ${ctx}: source no longer exists (likely disconnected)`,
        );
        return { artifactCount: 0, newCursor: null, skipReason: 'source_deleted' };
      }
      this.logger.warn(`sync_runs start insert failed ${ctx}: ${msg}`);
    }
    // Debounced heartbeat: connectors call reportProgress freely (once per
    // page / repo / channel), but we coalesce to one DB write every ~1s and
    // skip writes when nothing changed since the last one. Final state on
    // ok/failed comes from finishSyncRun*, not from this path.
    let lastProgressWriteAt = 0;
    let lastProgressKey = '';
    const reportProgress = (input: {
      current: number;
      total?: number | null;
      message?: string;
    }): void => {
      const now = Date.now();
      const key = `${input.current}/${input.total ?? ''}/${input.message ?? ''}`;
      if (key === lastProgressKey) return;
      if (now - lastProgressWriteAt < 1000) return;
      lastProgressKey = key;
      lastProgressWriteAt = now;
      updateSyncRunProgress(sql, {
        queueName: this.queueName,
        jobId,
        current: input.current,
        total: input.total ?? null,
        message: input.message ?? null,
      }).catch((err) => {
        this.logger.warn(
          `sync_runs progress update failed ${ctx}: ${(err as Error).message}`,
        );
      });
    };

    // Cooperative cancellation. The /stop endpoint flips sync_runs.status to
    // 'cancelled' but can't actually interrupt this Node promise — we poll our
    // own row and abort the controller when the user pressed Stop. Connectors
    // that thread the signal through (Slack today; others as they're wired)
    // exit at the next checkpoint instead of running to natural completion.
    const controller = new AbortController();
    const cancelPoll = setInterval(() => {
      sql<{ status: string }[]>`
        SELECT status FROM sync_runs
         WHERE queue_name = ${this.queueName} AND job_id = ${jobId}
         LIMIT 1
      `
        .then((rows) => {
          if (rows[0]?.status === 'cancelled' && !controller.signal.aborted) {
            controller.abort(
              holoError({
                code: ErrorCode.HOLO_SYNC_CANCELLED,
                problem: 'sync was cancelled by user',
                fix: 'Re-run the sync from the connector panel.',
              }),
            );
          }
        })
        .catch(() => {
          // A transient DB blip shouldn't kill the sync — just try again on
          // the next tick.
        });
    }, 1500);

    try {
      const result = await runSyncJob({
        queue: this.queueName,
        jobId,
        payload: job.data,
        runner: getSyncRunner(this.queueName),
        cursorStore: getCursorStore(),
        checkpointStore: getCheckpointStore(),
        reportProgress,
        signal: controller.signal,
      });
      try {
        await finishSyncRunOk(sql, {
          queueName: this.queueName,
          jobId,
          artifactCount: result.artifactCount,
          skipReason: result.skipReason ?? null,
          breakdown: result.breakdown ?? null,
        });
      } catch (err) {
        this.logger.warn(`sync_runs ok update failed ${ctx}: ${(err as Error).message}`);
      }
      this.logger.log(`synced ${ctx} artifacts=${result.artifactCount}`);
      recordAgentEvent(
        {
          db: getDb(),
          organizationId: job.data.organizationId,
          kind: 'connector_sync',
          name: provider,
          agentIdentity: `worker:sync:${provider}`,
          latencyMs: Date.now() - startedAtMs,
          inputJson: {
            sourceId: job.data.sourceId,
            queue: this.queueName,
            jobId,
          },
          outputJson: {
            artifactCount: result.artifactCount,
            skipReason: result.skipReason ?? null,
            breakdown: result.breakdown ?? null,
          },
        },
        (err) =>
          this.logger.warn(
            `agent_event record failed ${ctx}: ${(err as Error).message}`,
          ),
      );
      return result;
    } catch (err) {
      // User-initiated cancellation: the row is already 'cancelled' (set by
      // /stop), and finishSyncRunFailed's `WHERE status='running'` guard will
      // no-op against it. Log calmly and rethrow so BullMQ marks the job
      // failed without retry-spam.
      const cancelled =
        err instanceof HoloError && err.code === ErrorCode.HOLO_SYNC_CANCELLED;
      try {
        await finishSyncRunFailed(sql, {
          queueName: this.queueName,
          jobId,
          error: err,
        });
      } catch (e) {
        this.logger.warn(`sync_runs fail update failed ${ctx}: ${(e as Error).message}`);
      }
      const errorCode =
        err instanceof HoloError
          ? err.code
          : cancelled
            ? ErrorCode.HOLO_SYNC_CANCELLED
            : 'UNKNOWN';
      const errorMessage =
        err instanceof HoloError
          ? err.problem
          : ((err as Error)?.message ?? String(err));
      recordAgentEvent(
        {
          db: getDb(),
          organizationId: job.data.organizationId,
          kind: 'connector_sync',
          name: provider,
          agentIdentity: `worker:sync:${provider}`,
          latencyMs: Date.now() - startedAtMs,
          errorCode,
          inputJson: {
            sourceId: job.data.sourceId,
            queue: this.queueName,
            jobId,
          },
          outputJson: {
            error: errorMessage,
            cancelled,
          },
        },
        (e) =>
          this.logger.warn(
            `agent_event record failed ${ctx}: ${(e as Error).message}`,
          ),
      );
      if (cancelled) {
        this.logger.log(`cancelled ${ctx}`);
        throw err;
      }
      // Surface failures in the worker terminal with full HoloError context
      // (code + problem + cause + fix). Without this, BullMQ would swallow the
      // detail and the only place to see anything was the sync-history UI,
      // which previously also stripped the cause.
      if (err instanceof HoloError) {
        this.logger.error(
          `failed ${ctx} code=${err.code}\n  problem: ${err.problem}\n  cause:   ${err.cause ?? '<none>'}\n  fix:     ${err.fix}`,
        );
      } else {
        // Unwrap undici-style errors that hide the real cause behind a generic
        // "TypeError: fetch failed" message. The interesting bit is on .cause.
        const e = err as Error & { cause?: unknown; code?: string };
        const cause = e.cause
          ? `\n  cause:   ${(e.cause as Error)?.stack ?? String(e.cause)}`
          : '';
        const code = e.code ? ` errno=${e.code}` : '';
        this.logger.error(`failed ${ctx}${code} ${e.stack ?? String(e)}${cause}`);
      }
      throw err;
    } finally {
      clearInterval(cancelPoll);
    }
  }
}
