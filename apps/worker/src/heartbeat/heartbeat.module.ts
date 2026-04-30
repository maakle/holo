import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HeartbeatProcessor, HEARTBEAT_QUEUE } from './heartbeat.processor';
import { HeartbeatScheduler } from './heartbeat.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: HEARTBEAT_QUEUE })],
  providers: [HeartbeatProcessor, HeartbeatScheduler],
})
export class HeartbeatModule {}
