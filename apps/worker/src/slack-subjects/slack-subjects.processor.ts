import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createDb, schema, type DB } from '@holo/db';
import { createSlackUserApiClient } from '@holo/connectors';
import { runSlackSubjectsSync } from '@holo/user-subjects';

export const SLACK_SUBJECTS_QUEUE = 'slack-subjects-sync';

@Processor(SLACK_SUBJECTS_QUEUE)
export class SlackSubjectsProcessor extends WorkerHost {
  private readonly logger = new Logger(SlackSubjectsProcessor.name);
  private readonly db: DB;

  constructor() {
    super();
    this.db = createDb(process.env.DATABASE_URL ?? '');
  }

  async process(_job: Job): Promise<{ total: number; succeeded: number; failed: number }> {
    const rows = await this.db
      .select({
        userId: schema.slackUserCredentials.userId,
        organizationId: schema.slackUserCredentials.organizationId,
        accessToken: schema.slackUserCredentials.accessTokenEncrypted,
      })
      .from(schema.slackUserCredentials);

    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const client = createSlackUserApiClient(row.accessToken);
        const { count } = await runSlackSubjectsSync({
          db: this.db,
          userId: row.userId,
          organizationId: row.organizationId,
          client,
        });
        this.logger.log(`synced user=${row.userId} subjects=${count}`);
        succeeded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        this.logger.error(`sync failed for user=${row.userId}: ${msg}`);
        failed += 1;
      }
    }

    return { total: rows.length, succeeded, failed };
  }
}
