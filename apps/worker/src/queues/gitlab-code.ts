import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GITLAB_CODE_SYNC, { concurrency: QUEUE_CONCURRENCY['gitlab-code-sync'] })
export class GitlabCodeSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GITLAB_CODE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GITLAB_CODE_SYNC })],
  providers: [GitlabCodeSyncProcessor],
  exports: [BullModule],
})
export class GitlabCodeSyncModule {}
