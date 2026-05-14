import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  GoogleChatBotProcessor,
  GOOGLE_CHAT_BOT_QUEUE,
} from './google-chat-bot.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: GOOGLE_CHAT_BOT_QUEUE })],
  providers: [GoogleChatBotProcessor],
})
export class GoogleChatBotModule {}
