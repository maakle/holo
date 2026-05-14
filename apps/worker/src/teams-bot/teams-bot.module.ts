import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TeamsBotProcessor, TEAMS_BOT_QUEUE } from './teams-bot.processor.js';

@Module({
  imports: [BullModule.registerQueue({ name: TEAMS_BOT_QUEUE })],
  providers: [TeamsBotProcessor],
})
export class TeamsBotModule {}
