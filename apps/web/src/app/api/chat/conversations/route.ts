import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export const runtime = 'nodejs';

const createBodySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
  })
  .partial();

export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const rows = await db
      .select({
        id: schema.chatConversations.id,
        title: schema.chatConversations.title,
        updatedAt: schema.chatConversations.updatedAt,
        createdAt: schema.chatConversations.createdAt,
      })
      .from(schema.chatConversations)
      .where(
        and(
          eq(schema.chatConversations.organizationId, orgId),
          eq(schema.chatConversations.userId, session.user.id),
        ),
      )
      .orderBy(desc(schema.chatConversations.updatedAt))
      .limit(100);
    return NextResponse.json({ conversations: rows });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const parsed = createBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid request body',
        fix: 'Send { title?: string } or empty body.',
      });
    }
    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const [row] = await db
      .insert(schema.chatConversations)
      .values({
        organizationId: orgId,
        userId: session.user.id,
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
      })
      .returning({
        id: schema.chatConversations.id,
        title: schema.chatConversations.title,
        updatedAt: schema.chatConversations.updatedAt,
        createdAt: schema.chatConversations.createdAt,
      });
    return NextResponse.json({ conversation: row });
  } catch (e) {
    return handleError(e);
  }
}

function handleError(e: unknown) {
  if (e instanceof HoloError) {
    const status =
      e.code === 'HOLO_AUTH_NO_SESSION'
        ? 401
        : e.code === 'HOLO_INVALID_INPUT'
          ? 400
          : 400;
    return NextResponse.json(e.toJSON(), { status });
  }
  console.error('[api/chat/conversations] unexpected error', e);
  return NextResponse.json(
    { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
    { status: 500 },
  );
}
