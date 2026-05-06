import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { lt } from 'drizzle-orm';
import { createDb, schema } from '@holo/db';

export const OBSERVABILITY_RETENTION_QUEUE = 'observability-retention';

/**
 * Periodic prune of agent_events older than OBSERVABILITY_TTL_DAYS.
 * Runs once an hour via the scheduler. Fire-and-forget — the dashboard
 * is purely informational, so a failed prune is logged and retried.
 */
@Processor(OBSERVABILITY_RETENTION_QUEUE)
export class ObservabilityRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(ObservabilityRetentionProcessor.name);

  async process(_job: Job): Promise<{ deleted: number; cutoff: string } | { skipped: true }> {
    const ttlDays = Number(process.env.OBSERVABILITY_TTL_DAYS ?? 30);
    if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
      this.logger.log('retention disabled (OBSERVABILITY_TTL_DAYS=0)');
      return { skipped: true };
    }
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      this.logger.error('DATABASE_URL not set, skipping retention sweep');
      return { skipped: true };
    }
    const db = createDb(databaseUrl);
    const deleted = await db
      .delete(schema.mcpInvocations)
      .where(lt(schema.mcpInvocations.createdAt, cutoff))
      .returning({ id: schema.mcpInvocations.id });
    this.logger.log(
      `pruned ${deleted.length} agent_events older than ${cutoff.toISOString()} (ttlDays=${ttlDays})`,
    );
    return { deleted: deleted.length, cutoff: cutoff.toISOString() };
  }
}
