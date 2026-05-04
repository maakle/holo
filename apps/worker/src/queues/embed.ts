import { Module, Logger } from '@nestjs/common';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import {
  runEmbedJob,
  type EmbedderClient,
  type EmbedJobResult,
} from './embed-runner';
import type { EmbedJobPayload } from './embed-insert';

let cachedSql: Sql | null = null;
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
  cachedSql = postgres(url, { max: 4 });
  return cachedSql;
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
    const result = await runEmbedJob({
      payload: job.data,
      sql: getSql(),
      embedder: getEmbedder(),
    });
    this.logger.log(
      `embed job ${job.id} inserted=${result.inserted} openai=${result.perModel['openai-3-large']} voyage=${result.perModel['voyage-code-3']}`,
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
