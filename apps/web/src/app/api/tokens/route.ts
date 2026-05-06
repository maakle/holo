import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and, isNull } from 'drizzle-orm';
import { randomBytes, createHash } from 'node:crypto';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';

export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const tokens = await db
      .select({
        id: schema.apiTokens.id,
        tokenHash: schema.apiTokens.tokenHash,
        label: schema.apiTokens.label,
        createdAt: schema.apiTokens.createdAt,
      })
      .from(schema.apiTokens)
      .where(
        and(
          eq(schema.apiTokens.organizationId, orgId),
          eq(schema.apiTokens.userId, userId),
          isNull(schema.apiTokens.revokedAt),
        ),
      );

    return NextResponse.json({
      tokens: tokens.map((t) => ({
        id: t.id,
        prefix: `holo_${t.tokenHash.slice(0, 6)}...`,
        label: t.label,
        createdAt: t.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof HoloError)
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as { label?: string };
    const label = body.label?.trim() || 'default';

    const rawToken = `holo_${randomBytes(32).toString('hex')}`;
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const [inserted] = await db
      .insert(schema.apiTokens)
      .values({ organizationId: orgId, userId, tokenHash, label })
      .returning({ id: schema.apiTokens.id });

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'api_token.created',
      resourceType: 'api_token',
      resourceId: inserted?.id,
    });

    return NextResponse.json({ id: inserted?.id, token: rawToken, label });
  } catch (e) {
    if (e instanceof HoloError)
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
