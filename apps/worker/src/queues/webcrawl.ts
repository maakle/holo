import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.WEBCRAWL_SYNC, { concurrency: QUEUE_CONCURRENCY['webcrawl-sync'] })
export class WebcrawlSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.WEBCRAWL_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.WEBCRAWL_SYNC })],
  providers: [WebcrawlSyncProcessor],
  exports: [BullModule],
})
export class WebcrawlSyncModule {}
