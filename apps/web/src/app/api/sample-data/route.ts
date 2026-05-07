import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import {
  ensureSampleData,
  getSampleDataStatus,
  removeSampleData,
} from '@/lib/sample-data';

async function requireSession() {
  const ctx = await getServerContext();
  const session = await ctx.auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in first.',
    });
  }
  return { ...ctx, session, orgId: resolveActiveOrgId(session, ctx.defaultOrgId) };
}

export async function GET() {
  try {
    const { db, orgId } = await requireSession();
    const status = await getSampleDataStatus(db, orgId);
    return NextResponse.json(status);
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const { db, orgId, session } = await requireSession();
    const result = await ensureSampleData(db, orgId);
    if (result.created) {
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId: session.user.id,
        eventType: 'sample_data.installed',
        resourceType: 'sample_data',
        meta: { artifactCount: result.artifactCount, theme: 'star-wars' },
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const { db, orgId, session } = await requireSession();
    const result = await removeSampleData(db, orgId);
    if (result.removed) {
      emitAuditEvent({
        db,
        organizationId: orgId,
        userId: session.user.id,
        eventType: 'sample_data.removed',
        resourceType: 'sample_data',
      });
    }
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}
