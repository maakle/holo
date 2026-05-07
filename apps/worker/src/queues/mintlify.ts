import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.MINTLIFY_SYNC, { concurrency: QUEUE_CONCURRENCY['mintlify-sync'] })
export class MintlifySyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.MINTLIFY_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.MINTLIFY_SYNC })],
  providers: [MintlifySyncProcessor],
  exports: [BullModule],
})
export class MintlifySyncModule {}
