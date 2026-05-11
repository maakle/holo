import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { withActiveOrg } from '@/lib/with-active-org';
import {
  enqueueResync,
  isSyncProvider,
  SYNC_PROVIDERS_FIX_HINT,
  type Provider,
} from '@/lib/sync-queue';

export const POST = withActiveOrg<{ provider: string }>(
  async ({ ctx, session, orgId, params }) => {
    if (!isSyncProvider(params.provider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${params.provider}'`,
        fix: SYNC_PROVIDERS_FIX_HINT,
      });
    }
    const provider: Provider = params.provider;
    const userId = session.user.id;

    const sourceRows = await ctx.db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, provider),
        ),
      );

    if (sourceRows.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `no ${provider} source registered for this organization`,
        fix: 'Connect the provider first, then trigger a resync.',
      });
    }

    const enqueued: string[] = [];
    const deduped: string[] = [];
    for (const s of sourceRows) {
      const r = await enqueueResync(provider, { sourceId: s.id, organizationId: orgId });
      enqueued.push(...r.enqueued);
      deduped.push(...r.deduped);
    }

    emitAuditEvent({
      db: ctx.db,
      organizationId: orgId,
      userId,
      eventType: 'connector.resync_triggered',
      resourceType: 'connector',
      resourceId: provider,
      meta: { provider, sources: sourceRows.length, queues: enqueued, deduped },
    });

    return {
      ok: true,
      sources: sourceRows.length,
      queues: enqueued,
      deduped: deduped.length > 0 && enqueued.length === 0,
    };
  },
);
