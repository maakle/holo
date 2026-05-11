'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { updateOrgPreferencesSchema } from '../schemas';

export type UpdateOrgPreferencesState = {
  ok: boolean;
  error?: string;
};

export async function updateOrgPreferences(input: {
  organizationId: string;
  hideSampleData: boolean;
}): Promise<UpdateOrgPreferencesState> {
  const parsed = updateOrgPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { organizationId, hideSampleData } = parsed.data;

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
  const userId = session.user.id;
  const activeOrgId = resolveActiveOrgId(session);
  if (organizationId !== activeOrgId) {
    return { ok: false, error: 'Workspace mismatch. Refresh and try again.' };
  }

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return { ok: false, error: 'Only owners can edit workspace preferences.' };
  }

  const [org] = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) {
    return { ok: false, error: 'Workspace not found.' };
  }
  const nextMetadata = {
    ...((org.metadata ?? {}) as Record<string, unknown>),
    hideSampleData,
  };

  await db
    .update(schema.organization)
    .set({ metadata: nextMetadata })
    .where(eq(schema.organization.id, organizationId));

  emitAuditEvent({
    db,
    organizationId,
    userId,
    eventType: 'workspace.preferences.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    meta: { hideSampleData },
  });

  revalidatePath('/settings');
  revalidatePath('/connections');
  return { ok: true };
}
