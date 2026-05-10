import { Module, Logger } from '@nestjs/common';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createDb, schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import {
  DISCONNECT_CLEANUP_QUEUE,
  type DisconnectCleanupJobPayload,
} from '@holo/sync-providers';
import { QUEUE_CONCURRENCY } from './types';

/**
 * Async cleanup after a connector is disconnected.
 *
 * The DELETE route already performed all the time-sensitive work synchronously
 * — revoking the token, calling the provider's remote uninstall, dropping
 * credential / installation / service-account rows, and draining BullMQ. What
 * remains is the slow part: deleting `sources` for (org, provider), which
 * cascades through `source_artifacts` → `chunks` and can take minutes for
 * large workspaces.
 *
 * On success the matching `connector_disconnect_jobs` row is marked finished;
 * the dashboard's status poll picks that up and flips the row out of its
 * "Disconnecting…" state. On error we record the message on the row but let
 * BullMQ retry — most failures here are transient (DB lock contention).
 */
@Processor(DISCONNECT_CLEANUP_QUEUE, {
  concurrency: QUEUE_CONCURRENCY['disconnect-cleanup'],
})
export class DisconnectCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(DisconnectCleanupProcessor.name);

  async process(
    job: Job<DisconnectCleanupJobPayload>,
  ): Promise<{ removedSources: number; removedAllowlistRows: number }> {
    const { jobRowId, organizationId, provider } = job.data;
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw holoError({
        code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
        problem: 'DATABASE_URL is not set',
        fix: 'Export DATABASE_URL before starting the worker process.',
      });
    }
    const db = createDb(databaseUrl);

    try {
      // Cascading delete on sources removes source_artifacts → chunks via FK
      // ON DELETE cascade — the slow part for large workspaces.
      const deletedSources = await db
        .delete(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, organizationId),
            eq(schema.sources.provider, provider),
          ),
        )
        .returning({ id: schema.sources.id });

      // Allowlist rows are small but provider-scoped — drop them in the same
      // job so the next reconnect starts from a clean slate. (The DELETE
      // route already drops them synchronously for github/google service
      // accounts; this is a no-op in that case.)
      const deletedAllow = await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.organizationId, organizationId),
            eq(schema.connectorAllowlists.provider, provider),
          ),
        )
        .returning({ id: schema.connectorAllowlists.id });

      // Mark the job row finished so the dashboard flips out of
      // "Disconnecting…". We only update the row if it's still pending —
      // a duplicate enqueue (e.g. from a manual retry) shouldn't reopen
      // an already-finished cleanup.
      await db
        .update(schema.connectorDisconnectJobs)
        .set({ finishedAt: sql`now()`, error: null })
        .where(
          and(
            eq(schema.connectorDisconnectJobs.id, jobRowId),
            isNull(schema.connectorDisconnectJobs.finishedAt),
          ),
        );

      this.logger.log(
        `disconnect-cleanup ${jobRowId} ${organizationId}/${provider} `
          + `removedSources=${deletedSources.length} `
          + `removedAllowlistRows=${deletedAllow.length}`,
      );
      return {
        removedSources: deletedSources.length,
        removedAllowlistRows: deletedAllow.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Best-effort: persist the error on the row so the dashboard can
      // surface it. Don't swallow — let BullMQ retry per its policy.
      try {
        await db
          .update(schema.connectorDisconnectJobs)
          .set({ error: message })
          .where(eq(schema.connectorDisconnectJobs.id, jobRowId));
      } catch (writeErr) {
        this.logger.error(
          `failed to persist disconnect-cleanup error: ${
            writeErr instanceof Error ? writeErr.message : writeErr
          }`,
        );
      }
      throw err;
    }
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: DISCONNECT_CLEANUP_QUEUE })],
  providers: [DisconnectCleanupProcessor],
  exports: [BullModule],
})
export class DisconnectCleanupModule {}
