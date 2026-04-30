import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GRAIN_SYNC, { concurrency: QUEUE_CONCURRENCY['grain-sync'] })
export class GrainSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GRAIN_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GRAIN_SYNC })],
  providers: [GrainSyncProcessor],
  exports: [BullModule],
})
export class GrainSyncModule {}
