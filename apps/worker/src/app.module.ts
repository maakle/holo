import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { GithubCodeSyncModule } from './queues/github-code';
import { GithubProseSyncModule } from './queues/github-prose';
import { GitlabCodeSyncModule } from './queues/gitlab-code';
import { GitlabProseSyncModule } from './queues/gitlab-prose';
import { SlackSyncModule } from './queues/slack';
import { NotionSyncModule } from './queues/notion';
import { GrainSyncModule } from './queues/grain';
import { PylonSyncModule } from './queues/pylon';
import { HubspotSyncModule } from './queues/hubspot';
import { LinearSyncModule } from './queues/linear';
import { MintlifySyncModule } from './queues/mintlify';
import { ZendeskSyncModule } from './queues/zendesk';
import { GoogleDriveSyncModule } from './queues/googledrive';
import { AirtableSyncModule } from './queues/airtable';
import { GoogleChatSyncModule } from './queues/google-chat';
import { AsanaSyncModule } from './queues/asana';
import { EmbedModule } from './queues/embed';
import { EmbedBackfillModule } from './queues/embed-backfill';
import { DisconnectCleanupModule } from './queues/disconnect-cleanup';
import { SyncSchedulerModule } from './queues/sync-scheduler.module';
import { SyncRunnersModule } from './queues/runners.module';
import { SlackSubjectsModule } from './slack-subjects/slack-subjects.module';
import { SlackBotModule } from './slack-bot/slack-bot.module';
import { ObservabilityModule } from './observability/observability.module';

function parseRedisUrl(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        ...(process.env.NODE_ENV !== 'production' && {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,context',
              messageFormat: '{context} {msg}',
            },
          },
        }),
      },
    }),
    BullModule.forRoot({
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6382'),
    }),
    HeartbeatModule,
    SlackSubjectsModule,
    SlackBotModule,
    ObservabilityModule,
    GithubCodeSyncModule,
    GithubProseSyncModule,
    GitlabCodeSyncModule,
    GitlabProseSyncModule,
    SlackSyncModule,
    NotionSyncModule,
    GrainSyncModule,
    PylonSyncModule,
    HubspotSyncModule,
    LinearSyncModule,
    MintlifySyncModule,
    ZendeskSyncModule,
    GoogleDriveSyncModule,
    AirtableSyncModule,
    GoogleChatSyncModule,
    AsanaSyncModule,
    EmbedModule,
    EmbedBackfillModule,
    DisconnectCleanupModule,
    SyncRunnersModule,
    SyncSchedulerModule,
  ],
})
export class AppModule {}
