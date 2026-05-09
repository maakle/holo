import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.AIRTABLE_SYNC, { concurrency: QUEUE_CONCURRENCY['airtable-sync'] })
export class AirtableSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.AIRTABLE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.AIRTABLE_SYNC })],
  providers: [AirtableSyncProcessor],
  exports: [BullModule],
})
export class AirtableSyncModule {}
