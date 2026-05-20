import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BillingGrantsProcessor, BILLING_GRANTS_QUEUE } from './grants.processor';
import { BillingGrantsScheduler } from './grants.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: BILLING_GRANTS_QUEUE })],
  providers: [BillingGrantsProcessor, BillingGrantsScheduler],
})
export class BillingModule {}
