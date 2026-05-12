import { Module } from '@nestjs/common';
import { GithubCodeSyncModule } from './github-code';
import { GithubProseSyncModule } from './github-prose';
import { GitlabCodeSyncModule } from './gitlab-code';
import { GitlabProseSyncModule } from './gitlab-prose';
import { SlackSyncModule } from './slack';
import { NotionSyncModule } from './notion';
import { GrainSyncModule } from './grain';
import { PylonSyncModule } from './pylon';
import { HubspotSyncModule } from './hubspot';
import { LinearSyncModule } from './linear';
import { MintlifySyncModule } from './mintlify';
import { ZendeskSyncModule } from './zendesk';
import { GoogleDriveSyncModule } from './googledrive';
import { AirtableSyncModule } from './airtable';
import { GoogleChatSyncModule } from './google-chat';
import { AsanaSyncModule } from './asana';
import { JiraSyncModule } from './jira';
import { ConfluenceSyncModule } from './confluence';
import { StripeSyncModule } from './stripe';
import { SyncSchedulerService } from './sync-scheduler.service';

@Module({
  imports: [
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
    JiraSyncModule,
    ConfluenceSyncModule,
    StripeSyncModule,
  ],
  providers: [SyncSchedulerService],
})
export class SyncSchedulerModule {}
