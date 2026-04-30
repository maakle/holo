import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.NOTION_SYNC, { concurrency: QUEUE_CONCURRENCY['notion-sync'] })
export class NotionSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.NOTION_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTION_SYNC })],
  providers: [NotionSyncProcessor],
  exports: [BullModule],
})
export class NotionSyncModule {}
