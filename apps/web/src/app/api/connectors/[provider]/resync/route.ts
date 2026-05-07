import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { enqueueResync } from '@/lib/sync-queue';

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

    if (sourceRows.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `no ${provider} source registered for this organization`,
        fix: 'Connect the provider first, then trigger a resync.',
      });
    }

    const enqueued: string[] = [];
    for (const s of sourceRows) {
      const r = await enqueueResync(provider, { sourceId: s.id, organizationId: orgId });
      enqueued.push(...r.enqueued);
    }

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.resync_triggered',
      resourceType: 'connector',
      resourceId: provider,
      meta: { provider, sources: sourceRows.length, queues: enqueued },
    });

    return NextResponse.json({
      ok: true,
      sources: sourceRows.length,
      queues: enqueued,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
