import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ErrorCode, holoError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { withActiveOrg } from '@/lib/with-active-org';
import { MANUAL_UPLOAD_PROVIDER } from '@/lib/manual-upload';

/**
 * Delete one manual-upload session. FK cascade on
 * `source_artifacts.source_id` clears artifacts; cascade on
 * `chunks.source_artifact_id` clears chunks. Synchronous: a single session
 * typically holds at most a few thousand files, so one transaction is
 * fast enough to wait on. Unlike OAuth disconnects we don't need the
 * `disconnect-cleanup` queue here — there are no BullMQ jobs to drain and
 * no remote token to revoke.
 */
export const DELETE = withActiveOrg<{ sessionId: string }>(
  async ({ ctx, orgId, session, params }) => {
    const { db } = ctx;
    const userId = session.user.id;

    const [me] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
      )
      .limit(1);
    if (me?.role !== 'owner' && me?.role !== 'admin') {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'deleting an upload session requires the workspace owner or admin role',
        fix: 'Ask a workspace owner or admin to delete it.',
      });
    }

    const sessionId = params.sessionId;
    const deleted = await db
      .delete(schema.sources)
      .where(
        and(
          eq(schema.sources.id, sessionId),
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, MANUAL_UPLOAD_PROVIDER),
        ),
      )
      .returning({ id: schema.sources.id, name: schema.sources.name });

    if (deleted.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'manual upload session not found',
        fix: 'It may have already been deleted; refresh the page.',
      });
    }

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.disconnected',
      resourceType: 'connector',
      resourceId: MANUAL_UPLOAD_PROVIDER,
      meta: {
        provider: MANUAL_UPLOAD_PROVIDER,
        sessionId,
        name: deleted[0]?.name,
      },
    });

    return { ok: true, sessionId };
  },
);
