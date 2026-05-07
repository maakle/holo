import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.ZENDESK_SYNC, { concurrency: QUEUE_CONCURRENCY['zendesk-sync'] })
export class ZendeskSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.ZENDESK_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ZENDESK_SYNC })],
  providers: [ZendeskSyncProcessor],
  exports: [BullModule],
})
export class ZendeskSyncModule {}
