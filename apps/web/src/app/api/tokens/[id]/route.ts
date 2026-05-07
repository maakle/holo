import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    const { id } = await params;
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const [updated] = await db
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiTokens.id, id),
          eq(schema.apiTokens.organizationId, orgId),
          eq(schema.apiTokens.userId, userId),
          isNull(schema.apiTokens.revokedAt),
        ),
      )
      .returning({ id: schema.apiTokens.id });

    if (!updated)
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'token not found' },
        { status: 404 },
      );

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'api_token.revoked',
      resourceType: 'api_token',
      resourceId: updated.id,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError)
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}
