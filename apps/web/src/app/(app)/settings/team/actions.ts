'use server';

import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled } from '@/lib/ee/license';
import {
  inviteMemberSchema,
  cancelInvitationSchema,
  removeMemberSchema,
  joinViaInviteLinkSchema,
} from './schemas';

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateInviteToken(): string {
  return base64Url(randomBytes(32));
}

export async function inviteMember(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'admin',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  // Multi-role invites are EE — CE always invites as admin (full collaborator,
  // matching n8n's CE posture) regardless of what the client posted. The
  // owner role is reserved for the org creator. See invite-form.tsx for the
  // matching client behaviour and LICENSING.md for the RBAC positioning.
  const { email } = parsed.data;
  const role = isEnterpriseEnabled() ? parsed.data.role : 'admin';

  const { auth, db} = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  const orgId = resolveActiveOrgId(session);

  try {
    await auth.api.createInvitation({
      body: { email, role, organizationId: orgId },
      headers: reqHeaders,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Could not send invitation. Try again.',
    };
  }

  emitAuditEvent({
    db,
    organizationId: orgId,
    userId: session.user.id,
    eventType: 'member.invited',
    resourceType: 'invitation',
    meta: { email, role },
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

export async function cancelInvitation(formData: FormData): Promise<void> {
  const parsed = cancelInvitationSchema.safeParse({
    invitationId: formData.get('invitationId'),
  });
  if (!parsed.success) return;

  const { auth, db} = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  try {
    await auth.api.cancelInvitation({
      body: { invitationId: parsed.data.invitationId },
      headers: reqHeaders,
    });
    if (session) {
      emitAuditEvent({
        db,
        organizationId: resolveActiveOrgId(session),
        userId: session.user.id,
        eventType: 'member.invitation_cancelled',
        resourceType: 'invitation',
        resourceId: parsed.data.invitationId,
      });
    }
  } catch {
    // Silently swallow — revalidate will show whether it stuck.
  }
  revalidatePath('/settings/team');
}

export async function removeMember(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const parsed = removeMemberSchema.safeParse({
    memberId: formData.get('memberId'),
  });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid member id.' };
  }

  const { auth, db } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  const orgId = resolveActiveOrgId(session);

  try {
    await auth.api.removeMember({
      body: { memberIdOrEmail: parsed.data.memberId, organizationId: orgId },
      headers: reqHeaders,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not remove member.',
    };
  }

  emitAuditEvent({
    db,
    organizationId: orgId,
    userId: session.user.id,
    eventType: 'member.removed',
    resourceType: 'member',
    resourceId: parsed.data.memberId,
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

async function assertCanManage(
  db: import('@holo/db').DB,
  orgId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
    )
    .limit(1);
  const role = rows[0]?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_FORBIDDEN,
      problem: 'must be an owner or admin to manage the invite link',
      fix: 'Ask a workspace owner to manage the invite link.',
    });
  }
}

export async function regenerateInviteLink(): Promise<{
  ok: boolean;
  token?: string;
  error?: string;
}> {
  const { auth, db } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  const orgId = resolveActiveOrgId(session);
  await assertCanManage(db, orgId, session.user.id);

  const token = generateInviteToken();

  try {
    await db
      .insert(schema.orgInviteLink)
      .values({ organizationId: orgId, token, createdBy: session.user.id })
      .onConflictDoUpdate({
        target: schema.orgInviteLink.organizationId,
        set: { token, createdBy: session.user.id, createdAt: new Date() },
      });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not regenerate link.',
    };
  }

  emitAuditEvent({
    db,
    organizationId: orgId,
    userId: session.user.id,
    eventType: 'member.invite_link_regenerated',
    resourceType: 'org_invite_link',
  });

  revalidatePath('/settings/team');
  return { ok: true, token };
}

export async function revokeInviteLink(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { auth, db } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  const orgId = resolveActiveOrgId(session);
  await assertCanManage(db, orgId, session.user.id);

  await db
    .delete(schema.orgInviteLink)
    .where(eq(schema.orgInviteLink.organizationId, orgId));

  emitAuditEvent({
    db,
    organizationId: orgId,
    userId: session.user.id,
    eventType: 'member.invite_link_revoked',
    resourceType: 'org_invite_link',
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

export type JoinResult =
  | { ok: true; organizationId: string; alreadyMember: boolean }
  | { ok: false; reason: 'invalid_token' | 'no_session' | 'error'; error?: string };

export async function joinViaInviteLink(token: string): Promise<JoinResult> {
  const parsed = joinViaInviteLinkSchema.safeParse({ token });
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_token' };
  }

  const { auth, db } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    return { ok: false, reason: 'no_session' };
  }

  const linkRows = await db
    .select({
      organizationId: schema.orgInviteLink.organizationId,
    })
    .from(schema.orgInviteLink)
    .where(eq(schema.orgInviteLink.token, parsed.data.token))
    .limit(1);
  const link = linkRows[0];
  if (!link) {
    return { ok: false, reason: 'invalid_token' };
  }

  const existingMember = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, link.organizationId),
        eq(schema.member.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!existingMember[0]) {
    try {
      await db.insert(schema.member).values({
        organizationId: link.organizationId,
        userId: session.user.id,
        role: 'member',
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'error',
        error: err instanceof Error ? err.message : 'Could not join workspace.',
      };
    }

    emitAuditEvent({
      db,
      organizationId: link.organizationId,
      userId: session.user.id,
      eventType: 'member.joined_via_link',
      resourceType: 'member',
    });
  }

  // Switch the joiner's active workspace to the org they just joined. The
  // (app) layout reconciles activeOrganizationId against memberships, so a
  // direct write here is enough — no setActiveOrganization round-trip needed.
  const sessionRow = session.session as { id: string };
  await db
    .update(schema.session)
    .set({ activeOrganizationId: link.organizationId })
    .where(eq(schema.session.id, sessionRow.id));

  return {
    ok: true,
    organizationId: link.organizationId,
    alreadyMember: !!existingMember[0],
  };
}
