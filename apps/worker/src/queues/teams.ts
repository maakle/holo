import { Module } from '@nestjs/common';
import { BullModule, Processor } from '@nestjs/bullmq';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';
import { SyncProcessorBase } from './sync-processor-base';

/**
 * BullMQ queue + processor for the Microsoft Teams ingestion connector.
 *
 * Subclasses `SyncProcessorBase` for the same scheduling envelope every
 * other ingest connector uses (sync-runs row, progress reporting,
 * heartbeats, retry budget). The actual delta-cursor walk + thread
 * grouping lives in `packages/connectors/src/teams/sync.ts`; this
 * file only owns the BullMQ binding.
 *
 * Step 4b wires the standard sync-runner registry to dispatch
 * `runTenantSync` from `@holo/connectors`. Until that ships, the
 * processor is registered but never picks up jobs (no `addRepeatable`
 * scheduling has been wired into `sync-scheduler.service.ts` for
 * `'teams'` yet).
 */
@Processor(QUEUE_NAMES.TEAMS_SYNC, {
  concurrency: QUEUE_CONCURRENCY['teams-sync'],
})
export class TeamsSyncProcessor extends SyncProcessorBase {
  protected readonly queueName = QUEUE_NAMES.TEAMS_SYNC;
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.TEAMS_SYNC })],
  providers: [TeamsSyncProcessor],
  exports: [BullModule],
})
export class TeamsSyncModule {}
