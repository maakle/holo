import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.PYLON_SYNC, { concurrency: QUEUE_CONCURRENCY['pylon-sync'] })
export class PylonSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.PYLON_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.PYLON_SYNC })],
  providers: [PylonSyncProcessor],
  exports: [BullModule],
})
export class PylonSyncModule {}
