import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.ASANA_SYNC, { concurrency: QUEUE_CONCURRENCY['asana-sync'] })
export class AsanaSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.ASANA_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ASANA_SYNC })],
  providers: [AsanaSyncProcessor],
  exports: [BullModule],
})
export class AsanaSyncModule {}
