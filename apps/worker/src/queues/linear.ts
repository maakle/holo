import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.LINEAR_SYNC, { concurrency: QUEUE_CONCURRENCY['linear-sync'] })
export class LinearSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.LINEAR_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.LINEAR_SYNC })],
  providers: [LinearSyncProcessor],
  exports: [BullModule],
})
export class LinearSyncModule {}
