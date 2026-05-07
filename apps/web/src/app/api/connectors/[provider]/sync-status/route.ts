import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { activeQueueNames, getQueueByName } from '@/lib/sync-queue';

const PROVIDERS = new Set(['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'] as const);
type Provider = typeof PROVIDERS extends Set<infer T> ? T : never;

export async function GET(
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
    const orgId = resolveActiveOrgId(session, defaultOrgId);

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

    let running = false;
    if (sourceIds.size > 0) {
      // Only count jobs that are actively executing or queued for immediate
      // pickup. `delayed` jobs are scheduled for the future (e.g. the next 6h
      // recurring tick) and shouldn't trigger the "Syncing…" indicator.
      for (const name of activeQueueNames(provider)) {
        const queue = getQueueByName(name);
        const jobs = await queue.getJobs(['active', 'waiting']);
        for (const j of jobs) {
          const payload = j.data as { sourceId?: string; organizationId?: string } | undefined;
          if (
            payload?.organizationId === orgId &&
            payload.sourceId &&
            sourceIds.has(payload.sourceId)
          ) {
            running = true;
            break;
          }
        }
        if (running) break;
      }
    }

    let lastSyncedAt: string | null = null;
    let lastStatus: string | null = null;
    if (sourceIds.size > 0) {
      const cursorRows = await db
        .select({
          lastRunAt: schema.connectorCursors.lastRunAt,
          lastStatus: schema.connectorCursors.lastStatus,
        })
        .from(schema.connectorCursors)
        .where(
          and(
            eq(schema.connectorCursors.organizationId, orgId),
            inArray(schema.connectorCursors.sourceId, [...sourceIds]),
          ),
        );
      for (const c of cursorRows) {
        if (!c.lastRunAt) continue;
        if (!lastSyncedAt || new Date(c.lastRunAt) > new Date(lastSyncedAt)) {
          lastSyncedAt = c.lastRunAt.toISOString();
          lastStatus = c.lastStatus;
        }
      }
    }

    // Embed queue depth scoped to this org. Only counts work waiting or in
    // flight — not delayed retries.
    let embedQueued = 0;
    if (sourceIds.size > 0) {
      const embed = getQueueByName('embed');
      const jobs = await embed.getJobs(['waiting', 'active']);
      for (const j of jobs) {
        const payload = j.data as { organizationId?: string } | undefined;
        if (payload?.organizationId === orgId) embedQueued += 1;
      }
    }

    // Number of chunks already indexed for this provider's sources in this org.
    let chunksIndexed = 0;
    if (sourceIds.size > 0) {
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.chunks)
        .where(
          and(
            eq(schema.chunks.organizationId, orgId),
            eq(schema.chunks.provider, provider),
            inArray(schema.chunks.sourceId, [...sourceIds]),
          ),
        );
      chunksIndexed = rows[0]?.c ?? 0;
    }

    return NextResponse.json({
      running,
      lastSyncedAt,
      lastStatus,
      embedQueued,
      chunksIndexed,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
