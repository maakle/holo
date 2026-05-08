'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { inviteMemberSchema, cancelInvitationSchema } from './schemas';

export async function inviteMember(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const parsed = inviteMemberSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'member',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { email, role } = parsed.data;

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

  revalidatePath('/dashboard/team');
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
  revalidatePath('/dashboard/team');
}
