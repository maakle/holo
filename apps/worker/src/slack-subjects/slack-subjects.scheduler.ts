import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SLACK_SUBJECTS_QUEUE } from './slack-subjects.processor';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

@Injectable()
export class SlackSubjectsScheduler implements OnModuleInit {
  constructor(@InjectQueue(SLACK_SUBJECTS_QUEUE) private readonly q: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.q.add(
      'tick',
      {},
      {
        repeat: { every: THIRTY_MINUTES_MS },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
}
