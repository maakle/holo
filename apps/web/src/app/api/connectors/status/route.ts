import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { activeQueueNames, getQueueByName, SYNC_PROVIDERS } from '@/lib/sync-queue';

// Drive from sync-queue's source-of-truth list so adding a connector there
// automatically surfaces in the status poll. Hardcoding here previously left
// mintlify/linear/zendesk reporting "running=false, chunksIndexed=0" forever
// — the wizard's first-sync step then mis-fires "no new content" after 4s.
const PROVIDERS = SYNC_PROVIDERS;
type Provider = (typeof PROVIDERS)[number];

export type ConnectorSyncStatus = {
  running: boolean;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  embedQueued: number;
  chunksIndexed: number;
};

export type BulkStatusResponse = {
  statuses: Record<Provider, ConnectorSyncStatus>;
};

function emptyStatus(): ConnectorSyncStatus {
  return {
    running: false,
    lastSyncedAt: null,
    lastStatus: null,
    embedQueued: 0,
    chunksIndexed: 0,
  };
}

export async function GET() {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    const statuses = Object.fromEntries(
      PROVIDERS.map((p) => [p, emptyStatus()]),
    ) as Record<Provider, ConnectorSyncStatus>;

    const sourceRows = await db
      .select({ id: schema.sources.id, provider: schema.sources.provider })
      .from(schema.sources)
      .where(eq(schema.sources.organizationId, orgId));

    if (sourceRows.length === 0) {
      return NextResponse.json({ statuses } satisfies BulkStatusResponse);
    }

    const sourceIdToProvider = new Map<string, Provider>();
    const sourceIdsByProvider = Object.fromEntries(
      PROVIDERS.map((p) => [p, new Set<string>()]),
    ) as Record<Provider, Set<string>>;
    const allSourceIds: string[] = [];
    for (const s of sourceRows) {
      const p = s.provider as Provider;
      if (!(p in sourceIdsByProvider)) continue;
      sourceIdsByProvider[p].add(s.id);
      sourceIdToProvider.set(s.id, p);
      allSourceIds.push(s.id);
    }

    // "Running" comes from two signals:
    //   1. sync_runs.status='running' — the worker has started the job and
    //      hasn't reported completion. This is also what /stop flips to
    //      'cancelled', so the status here drops to false the moment the
    //      user presses Stop, even before the worker exits at its next
    //      checkpoint. (Reading BullMQ 'active' instead would keep the
    //      connector marked running until the runner physically returns.)
    //   2. BullMQ 'waiting' — a queued job that hasn't started yet.
    const runningRuns = await db
      .select({ provider: schema.syncRuns.provider })
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.organizationId, orgId),
          eq(schema.syncRuns.status, 'running'),
        ),
      );
    for (const r of runningRuns) {
      const p = r.provider as Provider;
      if (p in statuses) statuses[p].running = true;
    }

    const distinctQueueNames = new Set<string>();
    for (const p of PROVIDERS) {
      for (const q of activeQueueNames(p)) distinctQueueNames.add(q);
    }
    await Promise.all(
      [...distinctQueueNames].map(async (name) => {
        const queue = getQueueByName(name);
        const jobs = await queue.getJobs(['waiting']);
        for (const j of jobs) {
          const payload = j.data as { sourceId?: string; organizationId?: string } | undefined;
          if (payload?.organizationId !== orgId || !payload.sourceId) continue;
          const provider = sourceIdToProvider.get(payload.sourceId);
          if (!provider) continue;
          statuses[provider].running = true;
        }
      }),
    );

    // Last run / status — one query for all sources, then bucket.
    const cursorRows = await db
      .select({
        sourceId: schema.connectorCursors.sourceId,
        lastRunAt: schema.connectorCursors.lastRunAt,
        lastStatus: schema.connectorCursors.lastStatus,
      })
      .from(schema.connectorCursors)
      .where(
        and(
          eq(schema.connectorCursors.organizationId, orgId),
          inArray(schema.connectorCursors.sourceId, allSourceIds),
        ),
      );
    for (const c of cursorRows) {
      if (!c.lastRunAt) continue;
      const provider = sourceIdToProvider.get(c.sourceId);
      if (!provider) continue;
      const cur = statuses[provider];
      const iso = c.lastRunAt.toISOString();
      if (!cur.lastSyncedAt || new Date(iso) > new Date(cur.lastSyncedAt)) {
        cur.lastSyncedAt = iso;
        cur.lastStatus = c.lastStatus;
      }
    }

    // Embed queue is shared across providers; we only know the org from the
    // payload, not the provider. Charge embed depth equally across providers
    // that have at least one source — the per-provider breakdown isn't
    // semantically meaningful for embed work, and the previous endpoint
    // double-counted by querying the same queue once per provider.
    let embedQueuedTotal = 0;
    {
      const embed = getQueueByName('embed');
      const jobs = await embed.getJobs(['waiting', 'active']);
      for (const j of jobs) {
        const payload = j.data as { organizationId?: string } | undefined;
        if (payload?.organizationId === orgId) embedQueuedTotal += 1;
      }
    }
    for (const p of PROVIDERS) {
      if (sourceIdsByProvider[p].size > 0) statuses[p].embedQueued = embedQueuedTotal;
    }

    // Chunk counts grouped by provider in one round trip.
    const chunkRows = await db
      .select({
        provider: schema.chunks.provider,
        c: sql<number>`count(*)::int`,
      })
      .from(schema.chunks)
      .where(
        and(
          eq(schema.chunks.organizationId, orgId),
          inArray(schema.chunks.sourceId, allSourceIds),
        ),
      )
      .groupBy(schema.chunks.provider);
    for (const row of chunkRows) {
      const p = row.provider as Provider;
      if (p in statuses) statuses[p].chunksIndexed = row.c;
    }

    return NextResponse.json({ statuses } satisfies BulkStatusResponse);
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
