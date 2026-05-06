import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  ObservabilityRetentionProcessor,
  OBSERVABILITY_RETENTION_QUEUE,
} from './retention.processor';
import { ObservabilityRetentionScheduler } from './retention.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: OBSERVABILITY_RETENTION_QUEUE })],
  providers: [ObservabilityRetentionProcessor, ObservabilityRetentionScheduler],
})
export class ObservabilityModule {}
