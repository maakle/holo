import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES, SYNC_REPEAT_EVERY_MS, type SyncJobPayload } from './types';

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

@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.GITHUB_CODE_SYNC) private readonly ghCode: Queue,
    @InjectQueue(QUEUE_NAMES.GITHUB_PROSE_SYNC) private readonly ghProse: Queue,
    @InjectQueue(QUEUE_NAMES.SLACK_SYNC) private readonly slack: Queue,
    @InjectQueue(QUEUE_NAMES.NOTION_SYNC) private readonly notion: Queue,
    @InjectQueue(QUEUE_NAMES.GRAIN_SYNC) private readonly grain: Queue,
    @InjectQueue(QUEUE_NAMES.PYLON_SYNC) private readonly pylon: Queue,
    @InjectQueue(QUEUE_NAMES.HUBSPOT_SYNC) private readonly hubspot: Queue,
    @InjectQueue(QUEUE_NAMES.LINEAR_SYNC) private readonly linear: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.HOLO_SKIP_SYNC_SCHEDULER === '1') {
      this.logger.log('sync scheduler skipped (HOLO_SKIP_SYNC_SCHEDULER=1)');
      return;
    }
    try {
      const sources = await this.loadSources();
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
    const payload: SyncJobPayload = { sourceId: s.id, organizationId: s.organization_id };
    const repeat = { every: SYNC_REPEAT_EVERY_MS };

    if (s.provider === 'github') {
      // github sources drive both code and prose queues.
      await this.ghCode.add('sync', payload, { repeat });
      await this.ghProse.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'slack') {
      await this.slack.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'notion') {
      await this.notion.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'grain') {
      await this.grain.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'pylon') {
      await this.pylon.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'hubspot') {
      await this.hubspot.add('sync', payload, { repeat });
      return;
    }
    if (s.provider === 'linear') {
      await this.linear.add('sync', payload, { repeat });
      return;
    }
    this.logger.warn(`unknown provider '${s.provider}' for source ${s.id}; skipping schedule`);
  }
}
