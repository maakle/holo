import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { activeQueueNames, getQueueByName } from '@/lib/sync-queue';

const PROVIDERS = new Set(['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'] as const);
type Provider = typeof PROVIDERS extends Set<infer T> ? T : never;

type RunRow = {
  id: string;
  queue: string;
  state: 'completed' | 'failed' | 'stalled' | 'cancelled' | 'active' | 'waiting' | 'delayed';
  enqueuedAt: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  attempts: number;
  artifactCount: number | null;
  failedReason: string | null;
  failedFix: string | null;
  skipReason: string | null;
  /** Live count of chunks committed since the run started — only populated
   * for in-flight runs. Lets the UI show progress without waiting for the
   * worker's final artifact_count write. */
  liveArtifactCount: number | null;
  /** Connector heartbeat — set while running, cleared on each fresh start. */
  progressCurrent: number | null;
  progressTotal: number | null;
  progressMessage: string | null;
};

const RESPONSE_LIMIT = 20;
// Pull a bit more than we'll return so the merge of historic + live state has
// headroom — a job that's `active` in BullMQ is also a `running` row in
// sync_runs, and we want to dedupe by (queue, jobId) without truncating live
// state out of the result.
const HISTORIC_FETCH_LIMIT = RESPONSE_LIMIT * 2;

function maybeNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Defensive secret scrub at the API boundary. Any path that leaks a token into
 * an error string — including rows written before worker-side redaction
 * fixes shipped — gets cleaned here before it reaches the browser.
 */
function redactSecrets(s: string): string {
  return s
    .replace(/(https?:\/\/)([^@/\s]+)@/g, '$1<redacted>@')
    .replace(/gh[opusr]_[A-Za-z0-9]{20,}/g, '<redacted-token>')
    .replace(/xox[abpsr]-[A-Za-z0-9-]{10,}/g, '<redacted-token>');
}

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

    // Historic rows (completed / failed / stalled / running) come from
    // Postgres, which survives Redis flushes. Live state (active / waiting /
    // delayed) still comes from BullMQ since that's where the queue actually
    // lives. The two get merged below; a live job will shadow its 'running'
    // history row by (queue, jobId).
    const historicRows = await db
      .select({
        id: schema.syncRuns.id,
        sourceId: schema.syncRuns.sourceId,
        queueName: schema.syncRuns.queueName,
        jobId: schema.syncRuns.jobId,
        status: schema.syncRuns.status,
        startedAt: schema.syncRuns.startedAt,
        finishedAt: schema.syncRuns.finishedAt,
        durationMs: schema.syncRuns.durationMs,
        artifactCount: schema.syncRuns.artifactCount,
        errorCode: schema.syncRuns.errorCode,
        errorProblem: schema.syncRuns.errorProblem,
        skipReason: schema.syncRuns.skipReason,
        progressCurrent: schema.syncRuns.progressCurrent,
        progressTotal: schema.syncRuns.progressTotal,
        progressMessage: schema.syncRuns.progressMessage,
      })
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.organizationId, orgId),
          eq(schema.syncRuns.provider, provider),
        ),
      )
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(HISTORIC_FETCH_LIMIT);

    // Live counts for active runs: how many chunks have been committed since
    // the run started? One small query per active row keeps things simple —
    // the index on chunks(organization_id, source_id) makes each cheap.
    async function liveCountFor(
      sourceId: string,
      since: Date,
    ): Promise<number> {
      const rows = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.chunks)
        .where(
          and(
            eq(schema.chunks.organizationId, orgId),
            eq(schema.chunks.sourceId, sourceId),
            gt(schema.chunks.createdAt, since),
          ),
        );
      return rows[0]?.c ?? 0;
    }

    // Track each row's BullMQ jobId alongside the row so we can dedupe
    // historic 'running' entries against the same job's live BullMQ state.
    // The row's public `id` stays the postgres UUID for stable React keys.
    const rowJobIds = new Map<RunRow, string | null>();
    const rows: RunRow[] = await Promise.all(
      historicRows.map(async (r) => {
        const startedMs = r.startedAt ? r.startedAt.getTime() : null;
        const finishedMs = r.finishedAt ? r.finishedAt.getTime() : null;
        const state: RunRow['state'] =
          r.status === 'ok'
            ? 'completed'
            : r.status === 'failed'
              ? 'failed'
              : r.status === 'stalled'
                ? 'stalled'
                : r.status === 'cancelled'
                  ? 'cancelled'
                  : 'active';
        const problem = r.errorProblem ? redactSecrets(r.errorProblem) : null;
        // Only spend a query on rows that are still in flight — once a run
        // finishes, artifactCount is authoritative.
        const liveArtifactCount =
          state === 'active' && r.startedAt
            ? await liveCountFor(r.sourceId, r.startedAt)
            : null;
        const row: RunRow = {
          id: r.id,
          queue: r.queueName,
          state,
          enqueuedAt: startedMs,
          processedOn: startedMs,
          finishedOn: finishedMs,
          durationMs: r.durationMs,
          attempts: 0,
          artifactCount: r.artifactCount,
          failedReason: problem,
          failedFix: null,
          skipReason: r.skipReason ?? null,
          liveArtifactCount,
          progressCurrent: r.progressCurrent ?? null,
          progressTotal: r.progressTotal ?? null,
          progressMessage: r.progressMessage ?? null,
        };
        rowJobIds.set(row, r.jobId);
        return row;
      }),
    );

    // Live BullMQ state — only what's running NOW or queued for immediate
    // pickup. We deliberately skip `delayed` because those are scheduled
    // future ticks (the 6h scheduler), not runs — surfacing them as
    // "waiting" in the history panel was misleading.
    const seenJobKeys = new Set<string>();
    for (const r of rows) {
      const jid = rowJobIds.get(r);
      if (jid) seenJobKeys.add(`${r.queue}:${jid}`);
    }
    for (const name of activeQueueNames(provider)) {
      const queue = getQueueByName(name);
      const [active, waiting] = await Promise.all([
        queue.getJobs(['active']),
        queue.getJobs(['waiting']),
      ]);
      for (const j of [...active, ...waiting]) {
        const payload = j.data as { organizationId?: string } | undefined;
        if (payload?.organizationId !== orgId) continue;
        const jobId = String(j.id ?? '');
        const liveKey = `${name}:${jobId}`;
        // Replace the historic 'running' row with the live job's metadata —
        // the BullMQ row has accurate processedOn / waiting status that the
        // 'running' insert can't predict. Match on the BullMQ jobId stored
        // alongside the row, NOT row.id (which is the postgres UUID).
        const existingIdx = rows.findIndex(
          (r) => r.queue === name && rowJobIds.get(r) === jobId && r.state === 'active',
        );
        const finishedOn = maybeNumber(j.finishedOn);
        const processedOn = maybeNumber(j.processedOn);
        const enqueuedAt = maybeNumber(j.timestamp);
        const live: RunRow = {
          id: jobId,
          queue: name,
          state: processedOn && !finishedOn ? 'active' : 'waiting',
          enqueuedAt,
          processedOn,
          finishedOn,
          durationMs:
            finishedOn && processedOn ? Math.max(0, finishedOn - processedOn) : null,
          attempts: j.attemptsMade ?? 0,
          artifactCount: null,
          failedReason: null,
          failedFix: null,
          skipReason: null,
          liveArtifactCount: null,
          progressCurrent: null,
          progressTotal: null,
          progressMessage: null,
        };
        if (existingIdx >= 0) {
          // Carry forward the live/progress fields that come from postgres —
          // BullMQ doesn't know about them, so a naive replace would drop
          // the heartbeat the user is reading right now.
          const prior = rows[existingIdx]!;
          live.liveArtifactCount = prior.liveArtifactCount;
          live.progressCurrent = prior.progressCurrent;
          live.progressTotal = prior.progressTotal;
          live.progressMessage = prior.progressMessage;
          rows[existingIdx] = live;
        } else if (!seenJobKeys.has(liveKey)) {
          rows.push(live);
        }
      }
    }

    rows.sort((a, b) => {
      const aT = a.finishedOn ?? a.processedOn ?? a.enqueuedAt ?? 0;
      const bT = b.finishedOn ?? b.processedOn ?? b.enqueuedAt ?? 0;
      return bT - aT;
    });

    return NextResponse.json({ runs: rows.slice(0, RESPONSE_LIMIT) });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
