import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.HUBSPOT_SYNC, { concurrency: QUEUE_CONCURRENCY['hubspot-sync'] })
export class HubspotSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.HUBSPOT_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.HUBSPOT_SYNC })],
  providers: [HubspotSyncProcessor],
  exports: [BullModule],
})
export class HubspotSyncModule {}
