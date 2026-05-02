import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SlackSubjectsProcessor, SLACK_SUBJECTS_QUEUE } from './slack-subjects.processor';
import { SlackSubjectsScheduler } from './slack-subjects.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: SLACK_SUBJECTS_QUEUE })],
  providers: [SlackSubjectsProcessor, SlackSubjectsScheduler],
})
export class SlackSubjectsModule {}
