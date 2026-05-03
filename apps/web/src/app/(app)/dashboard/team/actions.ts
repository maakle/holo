'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

const ROLES = ['owner', 'admin', 'member'] as const;
type Role = (typeof ROLES)[number];

export async function inviteMember(formData: FormData): Promise<{
  ok: boolean;
  error?: string;
}> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const role = String(formData.get('role') ?? 'member') as Role;
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  if (!ROLES.includes(role)) {
    return { ok: false, error: 'Invalid role.' };
  }

  const { auth } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in and try again.',
    });
  }

  try {
    await auth.api.createInvitation({
      body: { email, role },
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

  revalidatePath('/dashboard/team');
  return { ok: true };
}

export async function cancelInvitation(formData: FormData): Promise<void> {
  const invitationId = String(formData.get('invitationId') ?? '');
  if (!invitationId) return;

  const { auth } = await getServerContext();
  const reqHeaders = await headers();

  try {
    await auth.api.cancelInvitation({
      body: { invitationId },
      headers: reqHeaders,
    });
  } catch {
    // Silently swallow — revalidate will show whether it stuck.
  }
  revalidatePath('/dashboard/team');
}
