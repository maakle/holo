import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createDb, type DB } from '@holo/db';
import { handleGoogleChatBotJob, type GoogleChatBotJob } from './handler.js';

export const GOOGLE_CHAT_BOT_QUEUE = 'google-chat-bot';

@Processor(GOOGLE_CHAT_BOT_QUEUE)
export class GoogleChatBotProcessor extends WorkerHost {
  private readonly logger = new Logger(GoogleChatBotProcessor.name);
  private readonly db: DB;
  private readonly anthropicApiKey: string | undefined;
  private readonly sharedServiceAccountJson: string | undefined;

  constructor() {
    super();
    this.db = createDb(process.env.DATABASE_URL ?? '');
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    this.sharedServiceAccountJson =
      process.env.GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON;
  }

  async process(
    job: Job<GoogleChatBotJob>,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      const result = await handleGoogleChatBotJob(job.data, {
        db: this.db,
        anthropicApiKey: this.anthropicApiKey,
        sharedServiceAccountJson: this.sharedServiceAccountJson,
        logError: (msg, err) =>
          this.logger.error(msg, err instanceof Error ? err.stack : err),
        logInfo: (msg, fields) =>
          this.logger.log(fields ? `${msg} ${JSON.stringify(fields)}` : msg),
      });
      if (!result.ok) {
        this.logger.warn(
          `google-chat-bot job ${job.id} skipped: ${result.reason} kind=${job.data.kind}`,
        );
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      this.logger.error(`google-chat-bot job ${job.id} failed: ${msg}`);
      // Same rationale as slack-bot.processor.ts: Google already got a
      // 200 ack and the asker is waiting for a reply that won't come.
      // Log and move on; failed jobs surface in the BullMQ dashboard.
      return { ok: false, reason: 'handler_threw' };
    }
  }
}
