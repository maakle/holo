import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingGrantsProcessor, BILLING_GRANTS_QUEUE } from './grants.processor';
import { BillingGrantsScheduler } from './grants.scheduler';
import { StripeProvisioningBootstrap } from './provisioning.bootstrap';

@Module({
  imports: [BullModule.registerQueue({ name: BILLING_GRANTS_QUEUE })],
  providers: [
    BillingGrantsProcessor,
    BillingGrantsScheduler,
    // Runs on worker boot — idempotently syncs billing_plans into Stripe.
    // No-op when HOLO_BILLING_ENABLED is off.
    StripeProvisioningBootstrap,
  ],
})
export class BillingModule {}
