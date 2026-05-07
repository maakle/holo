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
  ],
  providers: [SyncSchedulerService],
})
export class SyncSchedulerModule {}
