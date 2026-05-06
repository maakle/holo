import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function GET(
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

    const [row] = await db
      .select({ lastUsedAt: schema.apiTokens.lastUsedAt })
      .from(schema.apiTokens)
      .where(
        and(
          eq(schema.apiTokens.id, id),
          eq(schema.apiTokens.organizationId, defaultOrgId),
          eq(schema.apiTokens.userId, session.user.id),
          isNull(schema.apiTokens.revokedAt),
        ),
      )
      .limit(1);

    if (!row)
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'token not found' },
        { status: 404 },
      );

    return NextResponse.json({ lastUsedAt: row.lastUsedAt });
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
