'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

const INVITE_EXPIRY_DAYS = 7;

async function requireSession() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'no active session',
      fix: 'Sign in and try again.',
    });
  }
  const user = session.user as unknown as { id: string; email: string; organizationId: string };
  return { db, user };
}

async function requireOwnerOrAdmin(): Promise<{
  db: Awaited<ReturnType<typeof getServerContext>>['db'];
  user: { id: string; email: string; organizationId: string };
}> {
  const { db, user } = await requireSession();
  const rows = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, user.organizationId),
        eq(schema.member.userId, user.id),
      ),
    );
  const role = rows[0]?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_FORBIDDEN,
      problem: 'only owners and admins can manage team members',
      fix: 'Ask an owner of this workspace to perform this action.',
    });
  }
  return { db, user };
}

export async function inviteMember(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'member');
  if (!email || !email.includes('@')) {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'invalid email',
      fix: 'Enter a valid email address.',
    });
  }
  if (role !== 'member' && role !== 'admin') {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'invalid role',
      fix: 'Role must be "member" or "admin".',
    });
  }
  const { db, user } = await requireOwnerOrAdmin();

  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(schema.invitation).values({
    organizationId: user.organizationId,
    email,
    role,
    status: 'pending',
    token,
    expiresAt,
    inviterId: user.id,
  });

  revalidatePath('/dashboard/team');
}

export async function revokeInvitation(formData: FormData): Promise<void> {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) return;
  const { db, user } = await requireOwnerOrAdmin();

  await db
    .update(schema.invitation)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(schema.invitation.id, invitationId),
        eq(schema.invitation.organizationId, user.organizationId),
        eq(schema.invitation.status, 'pending'),
      ),
    );
  revalidatePath('/dashboard/team');
}

export async function removeMember(formData: FormData): Promise<void> {
  const memberId = String(formData.get('memberId') ?? '');
  if (!memberId) return;
  const { db, user } = await requireOwnerOrAdmin();

  // Block removing the last owner — the workspace would become unmanageable.
  const target = await db
    .select({ id: schema.member.id, role: schema.member.role, userId: schema.member.userId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.id, memberId),
        eq(schema.member.organizationId, user.organizationId),
      ),
    );
  const targetMember = target[0];
  if (!targetMember) return;

  if (targetMember.role === 'owner') {
    const ownerCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, user.organizationId),
          eq(schema.member.role, 'owner'),
        ),
      );
    if ((ownerCount[0]?.n ?? 0) <= 1) {
      throw holoError({
        code: ErrorCode.HOLO_VALIDATION,
        problem: 'cannot remove the last owner',
        fix: 'Promote another member to owner first.',
      });
    }
  }

  await db.delete(schema.member).where(eq(schema.member.id, memberId));
  revalidatePath('/dashboard/team');
}

export async function leaveWorkspace(): Promise<void> {
  const { db, user } = await requireSession();

  // Check role and owner-count before leaving.
  const myRow = await db
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, user.organizationId),
        eq(schema.member.userId, user.id),
      ),
    );
  const me = myRow[0];
  if (!me) {
    throw holoError({
      code: ErrorCode.HOLO_VALIDATION,
      problem: 'not a member of this workspace',
      fix: 'Refresh the page.',
    });
  }
  if (me.role === 'owner') {
    const ownerCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, user.organizationId),
          eq(schema.member.role, 'owner'),
        ),
      );
    if ((ownerCount[0]?.n ?? 0) <= 1) {
      throw holoError({
        code: ErrorCode.HOLO_VALIDATION,
        problem: 'cannot leave as the last owner',
        fix: 'Promote another member to owner first, or delete the workspace.',
      });
    }
  }

  await db.delete(schema.member).where(eq(schema.member.id, me.id));
  redirect('/sign-in');
}
