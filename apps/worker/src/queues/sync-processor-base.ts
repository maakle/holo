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
  cachedSql = postgres(url, { max: 4 });
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
    try {
      const result = await runSyncJob({
        queue: this.queueName,
        jobId,
        payload: job.data,
        runner: getSyncRunner(this.queueName),
        cursorStore: getCursorStore(),
        checkpointStore: getCheckpointStore(),
      });
      this.logger.log(`synced ${ctx} artifacts=${result.artifactCount}`);
      return result;
    } catch (err) {
      // Surface failures in the worker terminal with full HoloError context
      // (code + problem + cause + fix). Without this, BullMQ would swallow the
      // detail and the only place to see anything was the sync-history UI,
      // which previously also stripped the cause.
      if (err instanceof HoloError) {
        this.logger.error(
          `failed ${ctx} code=${err.code}\n  problem: ${err.problem}\n  cause:   ${err.cause ?? '<none>'}\n  fix:     ${err.fix}`,
        );
      } else {
        this.logger.error(`failed ${ctx} ${(err as Error).stack ?? String(err)}`);
      }
      throw err;
    }
  }
}
