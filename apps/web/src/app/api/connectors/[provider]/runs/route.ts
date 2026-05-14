import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  activeQueueNames,
  getQueueByName,
  isSyncProvider,
  SYNC_PROVIDERS_FIX_HINT,
  type Provider,
} from '@/lib/sync-queue';

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
  /** Short one-line summary, e.g. "GET https://… returned 403". */
  failedReason: string | null;
  /** Underlying provider error text (Google's "Enable the Chat API at …",
   * GitHub's rate-limit message, etc.). Often the actionable part. */
  failedCause: string | null;
  /** HoloError code (HOLO_FETCH_FAILED, HOLO_AUTH_NO_SESSION, …). */
  failedCode: string | null;
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
  /** Per-kind { new, deduped } counts, populated by the framework runner
   * on completion. Null on rows written before migration 0028 and on runs
   * that bailed before reaching the upsert path (skip_reason set). */
  breakdown: Record<string, { new: number; deduped: number }> | null;
  /** Provider-specific run flavour for UI grouping. Today this is the
   * webcrawl mode (`scrape` / `crawl`); the queue name on its own can't
   * distinguish them because both modes ride the same `webcrawl-sync` queue. */
  variant: string | null;
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

/**
 * Derive a user-actionable fix from error_problem + error_cause.
 *
 * The framework writes a `fix` field on every HoloError, but `sync_runs`
 * doesn't persist it (no error_fix column yet). For now we re-derive a fix
 * at API render time by pattern-matching the cause text we *did* persist —
 * provider error bodies are stable enough for this to be useful, and the
 * common cases (Google API not enabled, expired token, rate limit) are
 * exactly the ones where the generic "Re-authenticate the integration"
 * fallback was misleading.
 */
function deriveFix(args: {
  problem: string | null;
  cause: string | null;
}): string | null {
  const haystack = `${args.problem ?? ''}\n${args.cause ?? ''}`;
  // Google "API not enabled" — the cause string includes a console URL the
  // user can click straight through to.
  const apiDisabled = /API has not been used in project (\d+) before or it is disabled/i.exec(
    haystack,
  );
  if (apiDisabled) {
    const projectId = apiDisabled[1];
    const apiHost = /https:\/\/([a-z0-9-]+\.googleapis\.com)/i.exec(haystack)?.[1];
    if (projectId && apiHost) {
      return `Enable the ${apiHost} API in your Google Cloud project ${projectId}, wait ~1 minute, then retry.`;
    }
    return 'Enable the relevant Google API in your Cloud project, wait ~1 minute, then retry.';
  }
  // Google Chat-specific: even with the API enabled, the project needs a
  // configured "Chat app" (App name, status = LIVE) before /v1/spaces works.
  if (/Google Chat app not found/i.test(haystack)) {
    return 'Configure a Chat app in your Google Cloud project: open the Chat API → Configuration tab, set an App name, and set App status to "LIVE - available to users in your domain". Then retry.';
  }
  if (/PERMISSION_DENIED|insufficient.*scope/i.test(haystack)) {
    return 'Service account lacks the required scope. Re-check the Domain-wide Delegation entry in Workspace Admin and that you pasted all listed scopes.';
  }
  if (/invalid_grant|token.*expired|unauthorized_client/i.test(haystack)) {
    return 'Credentials are stale. Reconnect the integration to issue fresh tokens.';
  }
  if (/returned 401\b/.test(haystack)) {
    return 'Re-authenticate the integration — the token was rejected.';
  }
  if (/returned 403\b/.test(haystack)) {
    return 'The account is authenticated but lacks access. Verify scopes/permissions on the impersonated user or token.';
  }
  if (/returned 429\b|rate.?limit/i.test(haystack)) {
    return 'Provider rate-limited the sync. It will retry automatically; nothing to do unless this persists.';
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider: rawProvider } = await params;
    if (!isSyncProvider(rawProvider)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `unknown provider '${rawProvider}'`,
        fix: SYNC_PROVIDERS_FIX_HINT,
      });
    }
    const provider: Provider = rawProvider;
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
        breakdown: schema.syncRuns.breakdown,
        errorCode: schema.syncRuns.errorCode,
        errorProblem: schema.syncRuns.errorProblem,
        errorCause: schema.syncRuns.errorCause,
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

    // For providers whose queue name doesn't capture the user-visible mode
    // (today: webcrawl, where both `scrape` and `crawl` ride one queue),
    // fetch each row's source metadata so the UI can render a flavour tag.
    // Bounded by HISTORIC_FETCH_LIMIT distinct source ids — cheap.
    const variantBySourceId = new Map<string, string>();
    if (provider === 'webcrawl') {
      const sourceIds = Array.from(new Set(historicRows.map((r) => r.sourceId)));
      if (sourceIds.length > 0) {
        const srcs = await db
          .select({ id: schema.sources.id, metadata: schema.sources.metadata })
          .from(schema.sources)
          .where(
            and(
              eq(schema.sources.organizationId, orgId),
              inArray(schema.sources.id, sourceIds),
            ),
          );
        for (const s of srcs) {
          const mode = (s.metadata as { mode?: unknown } | null)?.mode;
          if (typeof mode === 'string') variantBySourceId.set(s.id, mode);
        }
      }
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
        const cause = r.errorCause ? redactSecrets(r.errorCause) : null;
        const fix = problem || cause ? deriveFix({ problem, cause }) : null;
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
          failedCause: cause,
          failedCode: r.errorCode ?? null,
          failedFix: fix,
          skipReason: r.skipReason ?? null,
          liveArtifactCount,
          progressCurrent: r.progressCurrent ?? null,
          progressTotal: r.progressTotal ?? null,
          progressMessage: r.progressMessage ?? null,
          breakdown: r.breakdown ?? null,
          variant: variantBySourceId.get(r.sourceId) ?? null,
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
        const payload = j.data as
          | { organizationId?: string; sourceId?: string }
          | undefined;
        if (payload?.organizationId !== orgId) continue;
        // Live jobs for a webcrawl source whose metadata we didn't fetch
        // above (because the source had no historic runs in the window yet)
        // would lose the flavour tag. Fall back to a one-off lookup so the
        // first run of a brand-new source still labels correctly.
        if (
          provider === 'webcrawl' &&
          payload.sourceId &&
          !variantBySourceId.has(payload.sourceId)
        ) {
          const [s] = await db
            .select({ metadata: schema.sources.metadata })
            .from(schema.sources)
            .where(
              and(
                eq(schema.sources.organizationId, orgId),
                eq(schema.sources.id, payload.sourceId),
              ),
            )
            .limit(1);
          const mode = (s?.metadata as { mode?: unknown } | undefined)?.mode;
          if (typeof mode === 'string') variantBySourceId.set(payload.sourceId, mode);
        }
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
          failedCause: null,
          failedCode: null,
          failedFix: null,
          skipReason: null,
          liveArtifactCount: null,
          progressCurrent: null,
          progressTotal: null,
          progressMessage: null,
          breakdown: null,
          variant: payload?.sourceId
            ? variantBySourceId.get(payload.sourceId) ?? null
            : null,
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
          // Prefer the prior row's variant when present — it's resolved from
          // the same source row and saves us a redundant lookup.
          if (prior.variant) live.variant = prior.variant;
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
