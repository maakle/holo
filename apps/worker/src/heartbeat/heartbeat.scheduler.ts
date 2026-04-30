import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { HEARTBEAT_QUEUE } from './heartbeat.processor';

@Injectable()
export class HeartbeatScheduler implements OnModuleInit {
  constructor(@InjectQueue(HEARTBEAT_QUEUE) private readonly q: Queue) {}

  async onModuleInit() {
    await this.q.add(
      'tick',
      {},
      {
        repeat: { every: 60_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
}
