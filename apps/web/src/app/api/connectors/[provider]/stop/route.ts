import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { activeQueueNames, getQueueByName } from '@/lib/sync-queue';

const PROVIDERS = new Set(['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'] as const);
type Provider = typeof PROVIDERS extends Set<infer T> ? T : never;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!PROVIDERS.has(rawProvider as Provider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${rawProvider}'`,
        fix: 'Use one of: github, slack, notion, grain, pylon, hubspot.',
      });
    }
    const provider = rawProvider as Provider;
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId =
      (session.user as unknown as { organizationId?: string }).organizationId ?? defaultOrgId;
    const userId = session.user.id;

    const sourceRows = await db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.organizationId, orgId),
          eq(schema.sources.provider, provider),
        ),
      );
    const sourceIds = new Set(sourceRows.map((s) => s.id));

    // Drop queued/delayed BullMQ jobs cleanly. We deliberately skip 'active'
    // here — j.remove() on an active job throws ("Could not remove active
    // job") in modern BullMQ, and even if it succeeded it wouldn't interrupt
    // the worker's in-flight promise. Active jobs are stopped via the
    // sync_runs.status flip below, which the worker polls and reacts to.
    let removed = 0;
    let activeFound = 0;
    for (const name of activeQueueNames(provider)) {
      const queue = getQueueByName(name);
      const queuedJobs = await queue.getJobs(['waiting', 'delayed']);
      for (const j of queuedJobs) {
        const payload = j.data as { sourceId?: string; organizationId?: string } | undefined;
        if (
          payload?.organizationId !== orgId ||
          !payload.sourceId ||
          !sourceIds.has(payload.sourceId)
        ) {
          continue;
        }
        try {
          await j.remove();
          removed += 1;
        } catch {
          // Race: another worker just picked it up. The sync_runs flip below
          // will catch it once the row appears.
        }
      }
      // Count active jobs for the user-facing message — purely informational.
      const activeJobs = await queue.getJobs(['active']);
      for (const j of activeJobs) {
        const payload = j.data as { sourceId?: string; organizationId?: string } | undefined;
        if (
          payload?.organizationId === orgId &&
          payload.sourceId &&
          sourceIds.has(payload.sourceId)
        ) {
          activeFound += 1;
        }
      }
    }

    // Cancel every in-flight sync_runs row for this org+provider. The worker's
    // per-job poll loop sees status='cancelled' within ~1.5s and aborts the
    // runner at the next checkpoint (between channels/pages/repos). Any
    // orphaned 'running' rows from a crashed worker also get cleaned up here
    // instead of waiting 30 min for the boot reconciler.
    const cancelled = await db
      .update(schema.syncRuns)
      .set({
        status: 'cancelled',
        finishedAt: new Date(),
        durationMs: sql`EXTRACT(EPOCH FROM (NOW() - ${schema.syncRuns.startedAt})) * 1000`,
      })
      .where(
        and(
          eq(schema.syncRuns.organizationId, orgId),
          eq(schema.syncRuns.provider, provider),
          eq(schema.syncRuns.status, 'running'),
        ),
      )
      .returning({ id: schema.syncRuns.id });

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.stopped',
      resourceType: 'connector',
      resourceId: provider,
      meta: {
        provider,
        removed,
        cancelled: cancelled.length,
        activeRunning: activeFound,
      },
    });

    return NextResponse.json({
      ok: true,
      removed,
      cancelled: cancelled.length,
      activeRunning: activeFound,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
