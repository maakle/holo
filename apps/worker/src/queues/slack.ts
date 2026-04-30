import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.SLACK_SYNC, { concurrency: QUEUE_CONCURRENCY['slack-sync'] })
export class SlackSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.SLACK_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SLACK_SYNC })],
  providers: [SlackSyncProcessor],
  exports: [BullModule],
})
export class SlackSyncModule {}
