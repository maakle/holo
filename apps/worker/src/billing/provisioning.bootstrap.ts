import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createDb } from '@holo/db';
import { billingEnabled } from '@holo/billing';
import { ensureStripeProductsForPlans } from '@holo/stripe';

/**
 * Worker boot hook: ensure every billing_plans row has a matching Stripe
 * Product + Price, and the price id is cached back into the DB. Idempotent
 * (lookup_key matches on retry) and cheap — runs in the background so a
 * Stripe outage doesn't block the worker from accepting jobs.
 *
 * No-op when HOLO_BILLING_ENABLED is off (CE installs).
 */
@Injectable()
export class StripeProvisioningBootstrap implements OnModuleInit {
  private readonly logger = new Logger(StripeProvisioningBootstrap.name);

  async onModuleInit(): Promise<void> {
    if (!billingEnabled()) {
      this.logger.log('billing disabled; skipping Stripe provisioning');
      return;
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.logger.warn('DATABASE_URL not set; skipping Stripe provisioning');
      return;
    }
    // Don't block worker startup on Stripe — fire and log.
    void (async () => {
      try {
        const db = createDb(databaseUrl);
        const result = await ensureStripeProductsForPlans(db);
        this.logger.log(
          `Stripe provisioning: ${result.provisioned} plan(s) provisioned, ${result.skipped} skipped`,
        );
      } catch (err) {
        this.logger.error(
          `Stripe provisioning failed: ${(err as Error).message}`,
        );
      }
    })();
  }
}
