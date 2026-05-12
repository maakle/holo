import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.PRISMIC_SYNC, { concurrency: QUEUE_CONCURRENCY['prismic-sync'] })
export class PrismicSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.PRISMIC_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.PRISMIC_SYNC })],
  providers: [PrismicSyncProcessor],
  exports: [BullModule],
})
export class PrismicSyncModule {}
