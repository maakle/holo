import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { GithubCodeSyncModule } from './queues/github-code';
import { GithubProseSyncModule } from './queues/github-prose';
import { SlackSyncModule } from './queues/slack';
import { NotionSyncModule } from './queues/notion';
import { GrainSyncModule } from './queues/grain';
import { PylonSyncModule } from './queues/pylon';
import { EmbedModule } from './queues/embed';
import { SyncSchedulerModule } from './queues/sync-scheduler.module';
import { SyncRunnersModule } from './queues/runners.module';
import { SlackSubjectsModule } from './slack-subjects/slack-subjects.module';

function parseRedisUrl(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {},
    }),
    BullModule.forRoot({
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6382'),
    }),
    HeartbeatModule,
    SlackSubjectsModule,
    GithubCodeSyncModule,
    GithubProseSyncModule,
    SlackSyncModule,
    NotionSyncModule,
    GrainSyncModule,
    PylonSyncModule,
    EmbedModule,
    SyncRunnersModule,
    SyncSchedulerModule,
  ],
})
export class AppModule {}
