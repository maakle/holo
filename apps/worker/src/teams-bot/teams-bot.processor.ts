import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createDb, type DB } from '@holo/db';
import { handleTeamsBotJob, type TeamsBotJob } from './handler.js';

export const TEAMS_BOT_QUEUE = 'teams-bot';

@Processor(TEAMS_BOT_QUEUE)
export class TeamsBotProcessor extends WorkerHost {
  private readonly logger = new Logger(TeamsBotProcessor.name);
  private readonly db: DB;
  private readonly anthropicApiKey: string | undefined;
  private readonly sharedAppId: string | undefined;
  private readonly sharedAppSecret: string | undefined;

  constructor() {
    super();
    this.db = createDb(process.env.DATABASE_URL ?? '');
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    this.sharedAppId = process.env.WORKER_TEAMS_BOT_APP_ID;
    this.sharedAppSecret = process.env.WORKER_TEAMS_BOT_APP_SECRET;
  }

  async process(job: Job<TeamsBotJob>): Promise<{ ok: boolean; reason?: string }> {
    try {
      const result = await handleTeamsBotJob(job.data, {
        db: this.db,
        anthropicApiKey: this.anthropicApiKey,
        sharedAppId: this.sharedAppId,
        sharedAppSecret: this.sharedAppSecret,
        logError: (msg, err) =>
          this.logger.error(msg, err instanceof Error ? err.stack : err),
        logInfo: (msg, fields) =>
          this.logger.log(fields ? `${msg} ${JSON.stringify(fields)}` : msg),
      });
      if (!result.ok) {
        this.logger.warn(
          `teams-bot job ${job.id} skipped: ${result.reason} tenant=${job.data.tenantId}`,
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`teams-bot job ${job.id} failed: ${msg}`);
      // Same rationale as slack-bot/google-chat-bot processors:
      // Microsoft already got a 200 ack; throwing here just spams the
      // BullMQ failure log. Surface in the dashboard instead.
      return { ok: false, reason: 'handler_threw' };
    }
  }
}
