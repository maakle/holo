import { Module } from '@nestjs/common';
import { GithubCodeSyncModule } from './github-code';
import { GithubProseSyncModule } from './github-prose';
import { SlackSyncModule } from './slack';
import { NotionSyncModule } from './notion';
import { SyncSchedulerService } from './sync-scheduler.service';

@Module({
  imports: [GithubCodeSyncModule, GithubProseSyncModule, SlackSyncModule, NotionSyncModule],
  providers: [SyncSchedulerService],
})
export class SyncSchedulerModule {}
