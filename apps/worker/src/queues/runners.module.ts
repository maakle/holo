import { Module, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createDb, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES } from './types';
import {
  createSlackRunner,
  createNotionRunner,
  createGithubProseRunner,
  createGithubCodeRunner,
} from './runners';
import { setSyncRunner } from './sync-runner-registry';
import type { EmbedJobPayload } from './embed-insert';

let cachedDb: DB | null = null;

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

// Test seam.
export function __setDbForTests(db: DB | null): void {
  cachedDb = db;
}

@Injectable()
export class SyncRunnersBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncRunnersBootstrap.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EMBED) private readonly embedQueue: Queue<EmbedJobPayload>,
  ) {}

  onApplicationBootstrap(): void {
    const deps = { db: getDb(), embedQueue: this.embedQueue };
    setSyncRunner(QUEUE_NAMES.SLACK_SYNC, createSlackRunner(deps));
    setSyncRunner(QUEUE_NAMES.NOTION_SYNC, createNotionRunner(deps));
    setSyncRunner(QUEUE_NAMES.GITHUB_PROSE_SYNC, createGithubProseRunner(deps));
    setSyncRunner(QUEUE_NAMES.GITHUB_CODE_SYNC, createGithubCodeRunner(deps));
    this.logger.log('Registered real SyncRunners for slack, notion, github-prose, github-code');
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMBED })],
  providers: [SyncRunnersBootstrap],
})
export class SyncRunnersModule {}
