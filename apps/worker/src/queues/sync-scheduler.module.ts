import { Module } from '@nestjs/common';
import { GithubCodeSyncModule } from './github-code';
import { GithubProseSyncModule } from './github-prose';
import { SlackSyncModule } from './slack';
import { NotionSyncModule } from './notion';
import { GrainSyncModule } from './grain';
import { PylonSyncModule } from './pylon';
import { HubspotSyncModule } from './hubspot';
import { LinearSyncModule } from './linear';
import { MintlifySyncModule } from './mintlify';
import { ZendeskSyncModule } from './zendesk';
import { GoogleDriveSyncModule } from './googledrive';
import { SyncSchedulerService } from './sync-scheduler.service';

@Module({
  imports: [
    GithubCodeSyncModule,
    GithubProseSyncModule,
    SlackSyncModule,
    NotionSyncModule,
    GrainSyncModule,
    PylonSyncModule,
    HubspotSyncModule,
    LinearSyncModule,
    MintlifySyncModule,
    ZendeskSyncModule,
    GoogleDriveSyncModule,
  ],
  providers: [SyncSchedulerService],
})
export class SyncSchedulerModule {}
