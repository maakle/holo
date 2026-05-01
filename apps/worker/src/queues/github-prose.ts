import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GITHUB_PROSE_SYNC, {
  concurrency: QUEUE_CONCURRENCY['github-prose-sync'],
})
export class GithubProseSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GITHUB_PROSE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GITHUB_PROSE_SYNC })],
  providers: [GithubProseSyncProcessor],
  exports: [BullModule],
})
export class GithubProseSyncModule {}
