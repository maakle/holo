import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '@holo/connectors';
import {
  isSyncProvider,
  type SyncProvider,
} from '@holo/sync-providers';
import { QUEUE_NAMES, type QueueName, type SyncJobPayload } from './types';

type SourceRow = {
  id: string;
  organization_id: string;
  provider: string;
};

let cachedSql: Sql | null = null;

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

// Test seam.
export function __setSchedulerSqlForTests(sql: Sql | null): void {
  cachedSql = sql;
}

/**
 * Per-provider mapping from provider id → BullMQ queue(s) that drive its
 * sync. GitHub fans out to two queues (code + prose) on the same cadence;
 * everything else is one queue per provider.
 */
type SyncQueueName = Exclude<QueueName, 'embed'>;
type QueueMap = Record<SyncProvider, ReadonlyArray<SyncQueueName>>;

@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SyncSchedulerService.name);

  private readonly queueMap: QueueMap;
  private readonly queuesByName: Record<Exclude<QueueName, 'embed'>, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.GITHUB_CODE_SYNC) ghCode: Queue,
    @InjectQueue(QUEUE_NAMES.GITHUB_PROSE_SYNC) ghProse: Queue,
    @InjectQueue(QUEUE_NAMES.SLACK_SYNC) slack: Queue,
    @InjectQueue(QUEUE_NAMES.NOTION_SYNC) notion: Queue,
    @InjectQueue(QUEUE_NAMES.GRAIN_SYNC) grain: Queue,
    @InjectQueue(QUEUE_NAMES.PYLON_SYNC) pylon: Queue,
    @InjectQueue(QUEUE_NAMES.HUBSPOT_SYNC) hubspot: Queue,
    @InjectQueue(QUEUE_NAMES.LINEAR_SYNC) linear: Queue,
    @InjectQueue(QUEUE_NAMES.MINTLIFY_SYNC) mintlify: Queue,
    @InjectQueue(QUEUE_NAMES.ZENDESK_SYNC) zendesk: Queue,
  ) {
    this.queueMap = {
      github: [QUEUE_NAMES.GITHUB_CODE_SYNC, QUEUE_NAMES.GITHUB_PROSE_SYNC],
      slack: [QUEUE_NAMES.SLACK_SYNC],
      notion: [QUEUE_NAMES.NOTION_SYNC],
      grain: [QUEUE_NAMES.GRAIN_SYNC],
      pylon: [QUEUE_NAMES.PYLON_SYNC],
      hubspot: [QUEUE_NAMES.HUBSPOT_SYNC],
      linear: [QUEUE_NAMES.LINEAR_SYNC],
      mintlify: [QUEUE_NAMES.MINTLIFY_SYNC],
      zendesk: [QUEUE_NAMES.ZENDESK_SYNC],
    };
    this.queuesByName = {
      [QUEUE_NAMES.GITHUB_CODE_SYNC]: ghCode,
      [QUEUE_NAMES.GITHUB_PROSE_SYNC]: ghProse,
      [QUEUE_NAMES.SLACK_SYNC]: slack,
      [QUEUE_NAMES.NOTION_SYNC]: notion,
      [QUEUE_NAMES.GRAIN_SYNC]: grain,
      [QUEUE_NAMES.PYLON_SYNC]: pylon,
      [QUEUE_NAMES.HUBSPOT_SYNC]: hubspot,
      [QUEUE_NAMES.LINEAR_SYNC]: linear,
      [QUEUE_NAMES.MINTLIFY_SYNC]: mintlify,
      [QUEUE_NAMES.ZENDESK_SYNC]: zendesk,
    };
  }

  async onModuleInit(): Promise<void> {
    if (process.env.HOLO_SKIP_SYNC_SCHEDULER === '1') {
      this.logger.log('sync scheduler skipped (HOLO_SKIP_SYNC_SCHEDULER=1)');
      return;
    }
    try {
      const sources = await this.loadSources();
      // Reconcile first: drop repeats whose `every` no longer matches the
      // spec's cadence. Without this, BullMQ keeps the old schedule alive
      // alongside the new one when intervals change between deploys, and
      // sources end up firing twice per cycle until the old key ages out.
      await this.reconcileRepeats(sources);
      for (const s of sources) {
        await this.scheduleSource(s);
      }
      this.logger.log(`scheduled repeating sync jobs for ${sources.length} source(s)`);
    } catch (err) {
      this.logger.error(`sync scheduler bootstrap failed: ${(err as Error).message}`);
    }
  }

  private async loadSources(): Promise<SourceRow[]> {
    const sql = getSql();
    return sql<SourceRow[]>`SELECT id, organization_id, provider FROM sources`;
  }

  private async scheduleSource(s: SourceRow): Promise<void> {
    if (!isSyncProvider(s.provider)) {
      this.logger.warn(`unknown provider '${s.provider}' for source ${s.id}; skipping schedule`);
      return;
    }
    const intervalMs = SYNC_INTERVAL_MS_BY_PROVIDER[s.provider];
    const payload: SyncJobPayload = { sourceId: s.id, organizationId: s.organization_id };
    const repeat = { every: intervalMs };
    for (const queueName of this.queueMap[s.provider]) {
      await this.queuesByName[queueName].add('sync', payload, { repeat });
    }
  }

  /**
   * Drops repeatable schedulers whose `every` doesn't match the current
   * spec cadence. BullMQ keys repeats by (name, cron/every, jobId), so a
   * cadence change creates a *new* key alongside the old one rather than
   * replacing it; we have to clear the old explicitly.
   */
  private async reconcileRepeats(sources: SourceRow[]): Promise<void> {
    const expectedByQueue = new Map<SyncQueueName, Set<number>>();
    for (const s of sources) {
      if (!isSyncProvider(s.provider)) continue;
      const intervalMs = SYNC_INTERVAL_MS_BY_PROVIDER[s.provider];
      for (const queueName of this.queueMap[s.provider]) {
        let set = expectedByQueue.get(queueName);
        if (!set) {
          set = new Set();
          expectedByQueue.set(queueName, set);
        }
        set.add(intervalMs);
      }
    }
    for (const [queueName, queue] of Object.entries(this.queuesByName) as Array<
      [SyncQueueName, Queue]
    >) {
      let cleared = 0;
      try {
        const repeats = await queue.getRepeatableJobs(0, -1, true);
        const expected = expectedByQueue.get(queueName) ?? new Set<number>();
        for (const r of repeats) {
          const every = typeof r.every === 'string' ? Number(r.every) : r.every;
          if (typeof every !== 'number' || !Number.isFinite(every)) continue;
          if (expected.has(every)) continue;
          await queue.removeRepeatableByKey(r.key);
          cleared += 1;
        }
      } catch (err) {
        this.logger.warn(
          `repeat reconcile failed for ${queueName}: ${(err as Error).message}`,
        );
        continue;
      }
      if (cleared > 0) {
        this.logger.log(
          `cleared ${cleared} stale repeat(s) on ${queueName} (intervals no longer match spec)`,
        );
      }
    }
  }
}
