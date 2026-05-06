import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { OBSERVABILITY_RETENTION_QUEUE } from './retention.processor';

const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class ObservabilityRetentionScheduler implements OnModuleInit {
  private readonly logger = new Logger(ObservabilityRetentionScheduler.name);

  constructor(@InjectQueue(OBSERVABILITY_RETENTION_QUEUE) private readonly q: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.q.add(
      'sweep',
      {},
      {
        repeat: { every: ONE_HOUR_MS },
        removeOnComplete: 24,
        removeOnFail: 24,
      },
    );
    this.logger.log('observability retention sweep scheduled every 1h');
  }
}
