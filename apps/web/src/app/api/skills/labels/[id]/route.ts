import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const { id } = await params;

    await db
      .delete(schema.skillLabels)
      .where(and(eq(schema.skillLabels.id, id), eq(schema.skillLabels.organizationId, orgId)));

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), { status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400 });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
