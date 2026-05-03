'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
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
  const parsed = cancelInvitationSchema.safeParse({
    invitationId: formData.get('invitationId'),
  });
  if (!parsed.success) return;

  const { auth } = await getServerContext();
  const reqHeaders = await headers();

  try {
    await auth.api.cancelInvitation({
      body: { invitationId: parsed.data.invitationId },
      headers: reqHeaders,
    });
  } catch {
    // Silently swallow — revalidate will show whether it stuck.
  }
  revalidatePath('/dashboard/team');
}
