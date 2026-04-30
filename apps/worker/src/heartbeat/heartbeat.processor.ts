import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export const HEARTBEAT_QUEUE = 'heartbeat';

@Processor(HEARTBEAT_QUEUE)
export class HeartbeatProcessor extends WorkerHost {
  private readonly logger = new Logger(HeartbeatProcessor.name);
  static counter = 0;

  async process(_job: Job): Promise<{ counter: number; ts: string }> {
    HeartbeatProcessor.counter += 1;
    const payload = { counter: HeartbeatProcessor.counter, ts: new Date().toISOString() };
    this.logger.log(`heartbeat tick ${JSON.stringify(payload)}`);
    return payload;
  }
}
