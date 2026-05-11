import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.JIRA_SYNC, { concurrency: QUEUE_CONCURRENCY['jira-sync'] })
export class JiraSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.JIRA_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.JIRA_SYNC })],
  providers: [JiraSyncProcessor],
  exports: [BullModule],
})
export class JiraSyncModule {}
