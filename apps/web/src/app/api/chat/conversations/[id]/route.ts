import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

export const runtime = 'nodejs';

const idSchema = z.string().uuid();

const patchBodySchema = z.object({
  title: z.string().trim().min(1).max(120),
});

async function loadOwnedConversation(
  conversationId: string,
  organizationId: string,
  userId: string,
) {
  const { db } = await getServerContext();
  const rows = await db
    .select()
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, conversationId),
        eq(schema.chatConversations.organizationId, organizationId),
        eq(schema.chatConversations.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const { id: idRaw } = await params;
    const idResult = idSchema.safeParse(idRaw);
    if (!idResult.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid conversation id',
        fix: 'Use a uuid.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const conv = await loadOwnedConversation(idResult.data, orgId, session.user.id);
    if (!conv) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'conversation not found' },
        { status: 404 },
      );
    }
    const messages = await db
      .select({
        id: schema.chatMessages.id,
        role: schema.chatMessages.role,
        text: schema.chatMessages.text,
        toolCalls: schema.chatMessages.toolCalls,
        modelCalls: schema.chatMessages.modelCalls,
        createdAt: schema.chatMessages.createdAt,
      })
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.conversationId, conv.id))
      .orderBy(asc(schema.chatMessages.createdAt));
    return NextResponse.json({ conversation: conv, messages });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const { id: idRaw } = await params;
    const idResult = idSchema.safeParse(idRaw);
    if (!idResult.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid conversation id',
        fix: 'Use a uuid.',
      });
    }
    const parsed = patchBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid request body',
        fix: 'Send { title: string }.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const conv = await loadOwnedConversation(idResult.data, orgId, session.user.id);
    if (!conv) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'conversation not found' },
        { status: 404 },
      );
    }
    const [row] = await db
      .update(schema.chatConversations)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(eq(schema.chatConversations.id, conv.id))
      .returning({
        id: schema.chatConversations.id,
        title: schema.chatConversations.title,
        updatedAt: schema.chatConversations.updatedAt,
      });
    return NextResponse.json({ conversation: row });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    const { id: idRaw } = await params;
    const idResult = idSchema.safeParse(idRaw);
    if (!idResult.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid conversation id',
        fix: 'Use a uuid.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const conv = await loadOwnedConversation(idResult.data, orgId, session.user.id);
    if (!conv) {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'conversation not found' },
        { status: 404 },
      );
    }
    await db.delete(schema.chatConversations).where(eq(schema.chatConversations.id, conv.id));
    return NextResponse.json({ ok: true });
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
  console.error('[api/chat/conversations/[id]] unexpected error', e);
  return NextResponse.json(
    { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
    { status: 500 },
  );
}
