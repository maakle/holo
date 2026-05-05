import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SlackBotProcessor, SLACK_BOT_QUEUE } from './slack-bot.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: SLACK_BOT_QUEUE })],
  providers: [SlackBotProcessor],
})
export class SlackBotModule {}
