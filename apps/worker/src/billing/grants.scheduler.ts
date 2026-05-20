import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { BILLING_GRANTS_QUEUE } from './grants.processor';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class BillingGrantsScheduler implements OnModuleInit {
  private readonly logger = new Logger(BillingGrantsScheduler.name);

  constructor(@InjectQueue(BILLING_GRANTS_QUEUE) private readonly q: Queue) {}

  async onModuleInit(): Promise<void> {
    // Hourly sweep is fine because the grant cron uses calendar-month boundaries
    // — a renewal that should fire at the month boundary will land within the
    // hour. Tightened to per-minute when PR 2 wires Stripe webhooks (the
    // webhook is real-time; the cron becomes a backstop).
    await this.q.add(
      'sweep',
      {},
      {
        repeat: { every: ONE_HOUR_MS },
        removeOnComplete: 24,
        removeOnFail: 24,
      },
    );
    this.logger.log('billing grants sweep scheduled every 1h');
  }
}
