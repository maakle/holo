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
import { PrismicSyncModule } from './queues/prismic';
import { ZendeskSyncModule } from './queues/zendesk';
import { WebcrawlSyncModule } from './queues/webcrawl';
import { GoogleDriveSyncModule } from './queues/googledrive';
import { AirtableSyncModule } from './queues/airtable';
import { GoogleChatSyncModule } from './queues/google-chat';
import { AsanaSyncModule } from './queues/asana';
import { StripeSyncModule } from './queues/stripe';
import { SalesforceSyncModule } from './queues/salesforce';
import { EmbedModule } from './queues/embed';
import { EmbedBackfillModule } from './queues/embed-backfill';
import { DisconnectCleanupModule } from './queues/disconnect-cleanup';
import { SkillEvalModule } from './queues/skill-eval';
import { SyncSchedulerModule } from './queues/sync-scheduler.module';
import { SyncRunnersModule } from './queues/runners.module';
import { SlackSubjectsModule } from './slack-subjects/slack-subjects.module';
import { SlackBotModule } from './slack-bot/slack-bot.module';
import { GoogleChatBotModule } from './google-chat-bot/google-chat-bot.module';
import { TeamsBotModule } from './teams-bot/teams-bot.module';
import { ObservabilityModule } from './observability/observability.module';
import { BillingModule } from './billing/billing.module';


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
      connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6382' },
    }),
    HeartbeatModule,
    SlackSubjectsModule,
    SlackBotModule,
    GoogleChatBotModule,
    TeamsBotModule,
    ObservabilityModule,
    BillingModule,
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
    PrismicSyncModule,
    ZendeskSyncModule,
    WebcrawlSyncModule,
    GoogleDriveSyncModule,
    AirtableSyncModule,
    GoogleChatSyncModule,
    AsanaSyncModule,
    StripeSyncModule,
    SalesforceSyncModule,
    EmbedModule,
    EmbedBackfillModule,
    DisconnectCleanupModule,
    SkillEvalModule,
    SyncRunnersModule,
    SyncSchedulerModule,
  ],
})
export class AppModule {}
