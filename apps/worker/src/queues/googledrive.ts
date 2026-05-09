import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GOOGLEDRIVE_SYNC, {
  concurrency: QUEUE_CONCURRENCY['googledrive-sync'],
})
export class GoogleDriveSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GOOGLEDRIVE_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GOOGLEDRIVE_SYNC })],
  providers: [GoogleDriveSyncProcessor],
  exports: [BullModule],
})
export class GoogleDriveSyncModule {}
