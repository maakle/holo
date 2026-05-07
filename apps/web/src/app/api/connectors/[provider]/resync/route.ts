import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  enqueueResync,
  isSyncProvider,
  SYNC_PROVIDERS_FIX_HINT,
  type Provider,
} from '@/lib/sync-queue';

export async function POST(
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
