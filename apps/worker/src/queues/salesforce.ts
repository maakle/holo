import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.SALESFORCE_SYNC, { concurrency: QUEUE_CONCURRENCY['salesforce-sync'] })
export class SalesforceSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.SALESFORCE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SALESFORCE_SYNC })],
  providers: [SalesforceSyncProcessor],
  exports: [BullModule],
})
export class SalesforceSyncModule {}
