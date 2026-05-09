import {
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import {
  runEmbedBackfillJob,
  type BackfillJobPayload,
  type BackfillResult,
} from './embed-backfill-runner';
import {
  countLegacyChunks,
  createBackfillStore,
  selectNextLegacyBatch,
} from './embed-backfill-store';
import type { EmbedderClient } from './embed-runner';

/**
 * OpenAI's batch limit is 100 inputs per /embeddings call. Matching the
 * job size to that limit means each job is exactly one upstream request.
 */
const BACKFILL_BATCH_SIZE = 100;

/**
 * Per-deploy ceiling on how many legacy chunks the boot scanner will
 * enqueue in one go. A safety brake: if there's a regression in the
 * processor (or OpenAI is down), an operator can ship a fix without
 * paying for millions of re-embeds first. Once backfill is healthy,
 * raise via `HOLO_EMBED_BACKFILL_CAP` or just re-deploy multiple times.
 */
const DEFAULT_BACKFILL_CAP_PER_BOOT = 100_000;

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
  cachedSql = postgres(url, { max: 2, onnotice: () => {} });
  return cachedSql;
}

function getEmbedder(): EmbedderClient {
  if (cachedEmbedder) return cachedEmbedder;
  throw holoError({
    code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
    problem: 'Embedder client not bound for embed-backfill',
    fix: 'Call setBackfillEmbedderClient(...) during worker bootstrap.',
  });
}

/** Bind the embedder used by the backfill processor. Called from main.ts. */
export function setBackfillEmbedderClient(embedder: EmbedderClient): void {
  cachedEmbedder = embedder;
}

// Test seams.
export function __setBackfillSqlForTests(sql: Sql | null): void {
  cachedSql = sql;
}
export function __setBackfillEmbedderForTests(embedder: EmbedderClient | null): void {
  cachedEmbedder = embedder;
}

@Processor(QUEUE_NAMES.EMBED_BACKFILL, {
  concurrency: QUEUE_CONCURRENCY['embed-backfill'],
})
export class EmbedBackfillProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedBackfillProcessor.name);

  async process(job: Job<BackfillJobPayload>): Promise<BackfillResult> {
    const result = await runEmbedBackfillJob({
      payload: job.data,
      embedder: getEmbedder(),
      store: createBackfillStore(getSql()),
    });
    this.logger.log(
      `embed-backfill job ${job.id} scanned=${result.scanned} rewritten=${result.rewritten} skipped=${result.skipped}`,
    );
    return result;
  }
}

@Injectable()
export class EmbedBackfillBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbedBackfillBootstrap.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMBED_BACKFILL) private readonly queue: Queue<BackfillJobPayload>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.HOLO_EMBED_BACKFILL_ENABLED !== '1') {
      this.logger.log(
        'embed-backfill scanner skipped (set HOLO_EMBED_BACKFILL_ENABLED=1 to run)',
      );
      return;
    }
    const cap = Number(process.env.HOLO_EMBED_BACKFILL_CAP)
      || DEFAULT_BACKFILL_CAP_PER_BOOT;
    try {
      const sql = getSql();
      const total = await countLegacyChunks(sql);
      if (total === 0) {
        this.logger.log('embed-backfill: no legacy chunks remain — done');
        return;
      }
      this.logger.log(
        `embed-backfill: ${total} legacy chunk(s) remain; enqueuing up to ${cap} this boot`,
      );

      // Walk the table in newest-first order, enqueuing batches of
      // BACKFILL_BATCH_SIZE until cap. The processor itself filters by
      // embedding_model again, so re-enqueueing the same chunk across
      // restarts is safe (it just no-ops the second time).
      let enqueued = 0;
      let lastBatchHadIds = true;
      // Track ids enqueued THIS boot so we don't re-enqueue the same id
      // twice (the SELECT keeps returning the same newest rows until the
      // processor has actually flipped them off `-large`).
      const seen = new Set<string>();
      while (enqueued < cap && lastBatchHadIds) {
        const ids = await selectNextLegacyBatch(sql, BACKFILL_BATCH_SIZE);
        const fresh = ids.filter((id) => !seen.has(id));
        if (fresh.length === 0) {
          lastBatchHadIds = false;
          break;
        }
        for (const id of fresh) seen.add(id);
        await this.queue.add(
          'backfill',
          { chunkIds: fresh },
          { removeOnComplete: 100, removeOnFail: 100 },
        );
        enqueued += fresh.length;
      }
      this.logger.log(`embed-backfill: enqueued ${enqueued} chunk(s) this boot`);
    } catch (err) {
      this.logger.error(
        `embed-backfill bootstrap failed: ${(err as Error).message}`,
      );
    }
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMBED_BACKFILL })],
  providers: [EmbedBackfillProcessor, EmbedBackfillBootstrap],
  exports: [BullModule],
})
export class EmbedBackfillModule {}
