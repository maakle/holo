import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
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

    let removed = 0;
    let activeRunning = 0;
    for (const name of activeQueueNames(provider)) {
      const queue = getQueueByName(name);
      const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
      for (const j of jobs) {
        const payload = j.data as { sourceId?: string; organizationId?: string } | undefined;
        if (
          payload?.organizationId !== orgId ||
          !payload.sourceId ||
          !sourceIds.has(payload.sourceId)
        ) {
          continue;
        }
        // Removing a waiting/delayed job drops it cleanly. Removing an active
        // job orphans it on the worker — the worker's next BullMQ update call
        // throws and the runner exits without writing a cursor, equivalent to
        // a crash. That's the right semantic for "stop now".
        try {
          const state = await j.getState();
          if (state === 'active') activeRunning += 1;
          await j.remove();
          removed += 1;
        } catch {
          // Ignore individual remove failures; report the count we did manage.
        }
      }
    }

    return NextResponse.json({
      ok: true,
      removed,
      activeRunning,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
