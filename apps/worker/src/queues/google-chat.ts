import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

@Processor(QUEUE_NAMES.GOOGLE_CHAT_SYNC, {
  concurrency: QUEUE_CONCURRENCY['google-chat-sync'],
})
export class GoogleChatSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.GOOGLE_CHAT_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.GOOGLE_CHAT_SYNC })],
  providers: [GoogleChatSyncProcessor],
  exports: [BullModule],
})
export class GoogleChatSyncModule {}
