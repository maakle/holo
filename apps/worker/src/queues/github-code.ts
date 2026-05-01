import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GITHUB_CODE_SYNC, { concurrency: QUEUE_CONCURRENCY['github-code-sync'] })
export class GithubCodeSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GITHUB_CODE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GITHUB_CODE_SYNC })],
  providers: [GithubCodeSyncProcessor],
  exports: [BullModule],
})
export class GithubCodeSyncModule {}
