import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createDb, type DB } from '@holo/db';
import { handleSlackBotJob, type SlackBotJob } from './handler.js';

export const SLACK_BOT_QUEUE = 'slack-bot';

@Processor(SLACK_BOT_QUEUE)
export class SlackBotProcessor extends WorkerHost {
  private readonly logger = new Logger(SlackBotProcessor.name);
  private readonly db: DB;
  private readonly anthropicApiKey: string | undefined;

  constructor() {
    super();
    this.db = createDb(process.env.DATABASE_URL ?? '');
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }

  async process(job: Job<SlackBotJob>): Promise<{ ok: boolean; reason?: string }> {
    try {
      const result = await handleSlackBotJob(job.data, {
        db: this.db,
        anthropicApiKey: this.anthropicApiKey,
      });
      if (!result.ok) {
        this.logger.warn(
          `slack-bot job ${job.id} skipped: ${result.reason} team=${job.data.teamId}`,
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`slack-bot job ${job.id} failed: ${msg}`);
      // Don't throw — Slack already got a 200 and the asker is waiting for a
      // reply that won't come. We log and move on; failed jobs surface in the
      // BullMQ dashboard for triage.
      return { ok: false, reason: 'handler_threw' };
    }
  }
}
