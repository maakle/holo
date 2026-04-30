import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
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
    const result = await runSyncJob({
      queue: this.queueName,
      jobId: job.id ?? `unidentified-${Date.now()}`,
      payload: job.data,
      runner: getSyncRunner(this.queueName),
      cursorStore: getCursorStore(),
      checkpointStore: getCheckpointStore(),
    });
    this.logger.log(
      `synced sourceId=${job.data.sourceId} queue=${this.queueName} artifacts=${result.artifactCount}`,
    );
    return result;
  }
}
