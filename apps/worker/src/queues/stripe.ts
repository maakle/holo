import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.STRIPE_SYNC, { concurrency: QUEUE_CONCURRENCY['stripe-sync'] })
export class StripeSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.STRIPE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.STRIPE_SYNC })],
  providers: [StripeSyncProcessor],
  exports: [BullModule],
})
export class StripeSyncModule {}
