import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { activeQueueNames, getQueueByName } from '@/lib/sync-queue';

const PROVIDERS = new Set(['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'] as const);
type Provider = typeof PROVIDERS extends Set<infer T> ? T : never;

type RunRow = {
  id: string;
  queue: string;
  state: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed';
  enqueuedAt: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  durationMs: number | null;
  attempts: number;
  artifactCount: number | null;
  failedReason: string | null;
  failedFix: string | null;
};

const PER_QUEUE_LIMIT = 25;
const RESPONSE_LIMIT = 20;

function maybeNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function extractFix(reason: string | undefined): { problem: string | null; fix: string | null } {
  if (!reason) return { problem: null, fix: null };
  // HoloError serializes as `${code}: ${problem} (fix: ${fix})` from holoError()
  const fixMatch = reason.match(/\(fix:\s*([^)]+)\)\s*$/);
  const fix = fixMatch?.[1]?.trim() ?? null;
  const problem = fix ? reason.replace(/\s*\(fix:[^)]+\)\s*$/, '').trim() : reason;
  return { problem, fix };
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
    const { auth, defaultOrgId } = await getServerContext();
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

    const rows: RunRow[] = [];
    for (const name of activeQueueNames(provider)) {
      const queue = getQueueByName(name);
      // Pull completed and failed in parallel; cap per-queue to keep it fast.
      const [completed, failed, active, waiting] = await Promise.all([
        queue.getJobs(['completed'], 0, PER_QUEUE_LIMIT - 1, false),
        queue.getJobs(['failed'], 0, PER_QUEUE_LIMIT - 1, false),
        queue.getJobs(['active']),
        queue.getJobs(['waiting']),
      ]);

      for (const j of [...completed, ...failed, ...active, ...waiting]) {
        const payload = j.data as { organizationId?: string } | undefined;
        if (payload?.organizationId !== orgId) continue;

        const finishedOn = maybeNumber(j.finishedOn);
        const processedOn = maybeNumber(j.processedOn);
        const enqueuedAt = maybeNumber(j.timestamp);
        const returnVal = (j.returnvalue ?? null) as { artifactCount?: number } | null;
        const reason = (j.failedReason ?? undefined) as string | undefined;
        const { problem, fix } = extractFix(reason);

        let state: RunRow['state'];
        if (finishedOn && !reason) state = 'completed';
        else if (reason) state = 'failed';
        else if (processedOn && !finishedOn) state = 'active';
        else state = 'waiting';

        rows.push({
          id: String(j.id ?? ''),
          queue: name,
          state,
          enqueuedAt,
          processedOn,
          finishedOn,
          durationMs:
            finishedOn && processedOn ? Math.max(0, finishedOn - processedOn) : null,
          attempts: j.attemptsMade ?? 0,
          artifactCount:
            typeof returnVal?.artifactCount === 'number' ? returnVal.artifactCount : null,
          failedReason: problem,
          failedFix: fix,
        });
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
