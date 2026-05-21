import { Module, Logger } from '@nestjs/common';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { createDb, type DB } from '@holo/db';
import { checkStorageQuota } from '@holo/billing';
import { holoError, ErrorCode } from '@holo/errors';
import { getWorkerPosthog } from '../posthog';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import {
  runEmbedJob,
  type EmbedderClient,
  type EmbedJobResult,
} from './embed-runner';
import type { EmbedJobPayload } from './embed-insert';

let cachedSql: Sql | null = null;
let cachedDb: DB | null = null;
let cachedEmbedder: EmbedderClient | null = null;

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
  // onnotice: drop server NOTICEs (e.g. "word is too long to be indexed" from
  // chunks_content_tsv_trigger when a code chunk contains a >2047-char token —
  // FTS skips that token, the row still inserts). Without this they flood the
  // worker terminal during code sync.
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

function getEmbedder(): EmbedderClient {
  if (cachedEmbedder) return cachedEmbedder;
  throw holoError({
    code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
    problem: 'Embedder client not bound in the worker',
    fix: 'Call setEmbedderClient(...) during worker bootstrap before any embed jobs run.',
  });
}

/** Bind the embedder used by the EmbedProcessor. Called from worker bootstrap. */
export function setEmbedderClient(embedder: EmbedderClient): void {
  cachedEmbedder = embedder;
}

// Test seams.
export function __setSqlForTests(sql: Sql | null): void {
  cachedSql = sql;
}
export function __setEmbedderForTests(embedder: EmbedderClient | null): void {
  cachedEmbedder = embedder;
}

@Processor(QUEUE_NAMES.EMBED, { concurrency: QUEUE_CONCURRENCY.embed })
export class EmbedProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProcessor.name);

  async process(job: Job<EmbedJobPayload>): Promise<EmbedJobResult> {
    // Defensive secondary cap check. The sync processor already gates with
    // `checkStorageQuota(db, orgId)` at run-start, but a single fat batch
    // (e.g. a fresh GitHub code sync emitting tens of thousands of chunks)
    // can otherwise blast far past the ceiling between gate checks. Ask
    // here "can this batch fit?" and short-circuit the whole batch if not —
    // we don't insert any chunks rather than partial-fill up to the cap,
    // because partial-fill would silently drop the rest of the batch with no
    // way to retry just the missing chunks. Cap-induced no-op is logged so
    // it's visible in PostHog + worker logs.
    const batchSize = job.data.chunks.length;
    if (batchSize > 0) {
      const storageDecision = await checkStorageQuota(
        getDb(),
        job.data.organizationId,
        batchSize,
      );
      if (!storageDecision.allowed) {
        this.logger.log(
          `embed job ${job.id} skipped: storage cap reached `
            + `(${storageDecision.currentCount}/${storageDecision.limit}, +${batchSize} would overflow) `
            + `— upgrade from ${storageDecision.currentPlanSlug}`,
        );
        getWorkerPosthog().capture({
          distinctId: `org:${job.data.organizationId}`,
          event: 'holo.storage.cap_reached',
          groups: { organization: job.data.organizationId },
          properties: {
            surface: 'embed',
            current_plan: storageDecision.currentPlanSlug,
            limit: storageDecision.limit,
            current_count: storageDecision.currentCount,
            batch_size: batchSize,
          },
        });
        return {
          inserted: 0,
          perModel: { 'openai-3-small': 0, 'openai-3-large': 0, 'voyage-code-3': 0 },
        };
      }
    }

    const result = await runEmbedJob({
      payload: job.data,
      sql: getSql(),
      embedder: getEmbedder(),
    });
    this.logger.log(
      `embed job ${job.id} inserted=${result.inserted} `
        + `openai-small=${result.perModel['openai-3-small']} `
        + `openai-large=${result.perModel['openai-3-large']} `
        + `voyage=${result.perModel['voyage-code-3']}`,
    );
    return result;
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMBED })],
  providers: [EmbedProcessor],
  exports: [BullModule],
})
export class EmbedModule {}
