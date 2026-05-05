import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
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
} from './sync-runs-store';
import type { QueueName, SyncJobPayload } from './types';

let cachedSql: Sql | null = null;
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
}): void {
  if (args.cursorStore) cachedCursorStore = args.cursorStore;
  if (args.checkpointStore) cachedCheckpointStore = args.checkpointStore;
}

export abstract class SyncProcessorBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);
  protected abstract readonly queueName: QueueName;

  async process(job: Job<SyncJobPayload>): Promise<SyncResult> {
    const jobId = job.id ?? `unidentified-${Date.now()}`;
    const ctx = `sourceId=${job.data.sourceId} queue=${this.queueName} jobId=${jobId}`;
    const sql = getSql();
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
      this.logger.warn(`sync_runs start insert failed ${ctx}: ${(err as Error).message}`);
    }
    try {
      const result = await runSyncJob({
        queue: this.queueName,
        jobId,
        payload: job.data,
        runner: getSyncRunner(this.queueName),
        cursorStore: getCursorStore(),
        checkpointStore: getCheckpointStore(),
      });
      try {
        await finishSyncRunOk(sql, {
          queueName: this.queueName,
          jobId,
          artifactCount: result.artifactCount,
          skipReason: result.skipReason ?? null,
        });
      } catch (err) {
        this.logger.warn(`sync_runs ok update failed ${ctx}: ${(err as Error).message}`);
      }
      this.logger.log(`synced ${ctx} artifacts=${result.artifactCount}`);
      return result;
    } catch (err) {
      try {
        await finishSyncRunFailed(sql, {
          queueName: this.queueName,
          jobId,
          error: err,
        });
      } catch (e) {
        this.logger.warn(`sync_runs fail update failed ${ctx}: ${(e as Error).message}`);
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
    }
  }
}
