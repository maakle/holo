import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GITLAB_PROSE_SYNC, {
  concurrency: QUEUE_CONCURRENCY['gitlab-prose-sync'],
})
export class GitlabProseSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GITLAB_PROSE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GITLAB_PROSE_SYNC })],
  providers: [GitlabProseSyncProcessor],
  exports: [BullModule],
})
export class GitlabProseSyncModule {}
