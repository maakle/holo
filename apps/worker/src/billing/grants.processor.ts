import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createDb } from '@holo/db';
import { processExpiredPeriods, processExpiredTopups, billingEnabled } from '@holo/billing';

export const BILLING_GRANTS_QUEUE = 'billing-grants';

/**
 * Periodic grant renewal. For every organization_subscriptions row whose
 * `current_period_end` has passed, advance the period and write a fresh
 * `grant` ledger row.
 *
 * In PR 1 this is the source of truth for monthly grants. PR 2 replaces this
 * with the Stripe `invoice.payment_succeeded` webhook handler — same function
 * (`processExpiredPeriods`) wrapped behind a different trigger.
 *
 * Also handles topup expiry (no-op in PR 1; topups don't exist yet).
 */
@Processor(BILLING_GRANTS_QUEUE)
export class BillingGrantsProcessor extends WorkerHost {
  private readonly logger = new Logger(BillingGrantsProcessor.name);

  async process(_job: Job): Promise<{ skipped?: true; grants?: number; expiries?: number }> {
    if (!billingEnabled()) {
      this.logger.log('billing disabled (HOLO_BILLING_ENABLED!=true); skipping');
      return { skipped: true };
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.logger.error('DATABASE_URL not set, skipping billing grants sweep');
      return { skipped: true };
    }
    const db = createDb(databaseUrl);
    const grants = await processExpiredPeriods(db);
    const expiries = await processExpiredTopups(db);
    if (grants > 0 || expiries > 0) {
      this.logger.log(`billing sweep: ${grants} grant(s), ${expiries} expiry(ies)`);
    }
    return { grants, expiries };
  }
}
