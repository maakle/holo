import { Module, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import postgres from 'postgres';
import { createDb, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { QUEUE_NAMES } from './types';
import {
  createSlackRunner,
  createNotionRunner,
  createGithubProseRunner,
  createGithubCodeRunner,
  createGrainRunner,
  createPylonRunner,
  createHubspotRunner,
} from './runners';
import { createGenericRunner } from './framework-bridge';
import { createLinearSpec } from '@holo/connectors';
import { setSyncRunner } from './sync-runner-registry';
import { reconcileOrphanedRuns } from './sync-runs-store';
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

  async onApplicationBootstrap(): Promise<void> {
    const deps = { db: getDb(), embedQueue: this.embedQueue };
    setSyncRunner(QUEUE_NAMES.SLACK_SYNC, createSlackRunner(deps));
    setSyncRunner(QUEUE_NAMES.NOTION_SYNC, createNotionRunner(deps));
    setSyncRunner(QUEUE_NAMES.GITHUB_PROSE_SYNC, createGithubProseRunner(deps));
    setSyncRunner(QUEUE_NAMES.GITHUB_CODE_SYNC, createGithubCodeRunner(deps));
    setSyncRunner(QUEUE_NAMES.GRAIN_SYNC, createGrainRunner(deps));
    setSyncRunner(QUEUE_NAMES.PYLON_SYNC, createPylonRunner(deps));
    setSyncRunner(QUEUE_NAMES.HUBSPOT_SYNC, createHubspotRunner(deps));
    // Linear is the first framework-native connector. createGenericRunner
    // turns any ConnectorSpec into a SyncRunner via the framework's
    // runConnectorSync + a Drizzle-backed RuntimeStores in framework-bridge.
    // OAuth credentials are present at boot only when the env vars are set;
    // we still register the spec so the queue exists either way (a sync job
    // will fail with NOT_IMPLEMENTED if creds are missing, matching how the
    // other OAuth runners behave).
    setSyncRunner(
      QUEUE_NAMES.LINEAR_SYNC,
      createGenericRunner(
        createLinearSpec({
          clientId: process.env.LINEAR_CONNECTOR_CLIENT_ID ?? '',
          clientSecret: process.env.LINEAR_CONNECTOR_CLIENT_SECRET ?? '',
        }),
        deps,
      ),
    );
    this.logger.log(
      'Registered real SyncRunners for slack, notion, github-prose, github-code, grain, pylon, hubspot, linear',
    );

    // Reap any 'running' rows the previous worker incarnation left behind
    // (crash, OOM, BullMQ stall). Without this, a dead worker's rows stay
    // 'running' forever and pollute the dashboard. 30-min floor inside
    // reconcileOrphanedRuns prevents reaping legitimately long syncs.
    try {
      const url = process.env.DATABASE_URL;
      if (url) {
        const sql = postgres(url, { max: 1, onnotice: () => {} });
        const swept = await reconcileOrphanedRuns(sql);
        await sql.end({ timeout: 5 });
        if (swept > 0) {
          this.logger.log(`reconciled ${swept} orphaned sync_runs row(s) → stalled`);
        }
      }
    } catch (err) {
      this.logger.warn(`sync_runs reconciliation failed: ${(err as Error).message}`);
    }
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.EMBED })],
  providers: [SyncRunnersBootstrap],
})
export class SyncRunnersModule {}
