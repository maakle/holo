'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { updateWorkspaceSchema, workspaceNameSchema, workspaceSlugSchema } from '../schemas';

export type UpdateWorkspaceState = {
  ok: boolean;
  error?: string;
  field?: 'name' | 'slug';
  value?: string;
};

export async function updateWorkspace(
  _prev: UpdateWorkspaceState,
  formData: FormData,
): Promise<UpdateWorkspaceState> {
  const parsed = updateWorkspaceSchema.safeParse({
    organizationId: formData.get('organizationId'),
    field: formData.get('field'),
    value: formData.get('value'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { organizationId, field, value } = parsed.data;

  const valueParsed =
    field === 'name' ? workspaceNameSchema.safeParse(value) : workspaceSlugSchema.safeParse(value);
  if (!valueParsed.success) {
    return {
      ok: false,
      field,
      error: valueParsed.error.issues[0]?.message ?? 'Invalid value.',
    };
  }
  const cleanValue = valueParsed.data;

  const { auth, db, defaultOrgId } = await getServerContext();
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
    return { ok: false, field, error: 'Workspace mismatch. Refresh and try again.' };
  }

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return { ok: false, field, error: 'Only owners can edit workspace details.' };
  }

  if (field === 'slug' && organizationId === defaultOrgId) {
    return {
      ok: false,
      field,
      error: 'The default workspace slug cannot be changed.',
    };
  }

  if (field === 'slug') {
    const [conflict] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(
        and(eq(schema.organization.slug, cleanValue), ne(schema.organization.id, organizationId)),
      )
      .limit(1);
    if (conflict) {
      return { ok: false, field, error: 'That slug is already taken.' };
    }
  }

  await db
    .update(schema.organization)
    .set(field === 'name' ? { name: cleanValue } : { slug: cleanValue })
    .where(eq(schema.organization.id, organizationId));

  emitAuditEvent({
    db,
    organizationId,
    userId,
    eventType: 'workspace.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    meta: { field, value: cleanValue },
  });

  // 'layout' invalidates the (app) layout that fetches memberOrgs for the
  // sidebar OrgSwitcher; without it, the trigger keeps the old name until
  // a full page reload.
  revalidatePath('/settings', 'layout');
  return { ok: true, field, value: cleanValue };
}
