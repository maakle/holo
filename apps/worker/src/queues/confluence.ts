import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.CONFLUENCE_SYNC, { concurrency: QUEUE_CONCURRENCY['confluence-sync'] })
export class ConfluenceSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.CONFLUENCE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.CONFLUENCE_SYNC })],
  providers: [ConfluenceSyncProcessor],
  exports: [BullModule],
})
export class ConfluenceSyncModule {}
