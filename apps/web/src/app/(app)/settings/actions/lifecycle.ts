'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { deleteWorkspaceSchema, leaveWorkspaceSchema } from '../schemas';

export type DeleteWorkspaceState = {
  ok: boolean;
  error?: string;
};

export type LeaveWorkspaceState = {
  ok: boolean;
  error?: string;
};

export async function deleteWorkspace(
  _prev: DeleteWorkspaceState,
  formData: FormData,
): Promise<DeleteWorkspaceState> {
  const parsed = deleteWorkspaceSchema.safeParse({
    organizationId: formData.get('organizationId'),
    confirmName: formData.get('confirmName'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { organizationId, confirmName } = parsed.data;

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
    return { ok: false, error: 'Workspace mismatch. Refresh and try again.' };
  }
  if (organizationId === defaultOrgId) {
    return { ok: false, error: 'The default workspace cannot be deleted.' };
  }

  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  if (!org) {
    return { ok: false, error: 'Workspace not found.' };
  }
  if (confirmName.trim().toLowerCase() !== 'delete') {
    return { ok: false, error: 'Type "delete" to confirm.' };
  }

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    return { ok: false, error: 'Only owners can delete a workspace.' };
  }

  // Refuse if any user has this org as their home org — those users would
  // otherwise be left with a dangling home reference (FK is no-action).
  const homeUsers = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.organizationId, organizationId))
    .limit(1);
  if (homeUsers[0]) {
    return {
      ok: false,
      error:
        "Can't delete: this is some user's home workspace. Have those members switch their home workspace first.",
    };
  }

  // Audit before delete (the row itself will be removed by cascade, but the
  // event also signals the deletion in any downstream sinks).
  emitAuditEvent({
    db,
    organizationId,
    userId,
    eventType: 'workspace.deleted',
    resourceType: 'organization',
    resourceId: organizationId,
    meta: { name: org.name },
  });

  // Pick the next active org BEFORE deletion so we can re-point the caller's
  // session directly to it. Without this, we'd null `activeOrganizationId`
  // and rely on the (app) layout to reconcile + redirect again — an extra
  // round trip the user perceives as a flash/reload spike right after
  // confirming the delete.
  const homeOrgId = (session.user as { organizationId?: string }).organizationId;
  let nextActiveOrgId: string | null =
    homeOrgId && homeOrgId !== organizationId ? homeOrgId : null;
  if (!nextActiveOrgId) {
    const candidates = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(
        and(eq(schema.member.userId, userId), ne(schema.member.organizationId, organizationId)),
      )
      .limit(1);
    nextActiveOrgId = candidates[0]?.organizationId ?? null;
  }

  await db.transaction(async (tx) => {
    // Tables that reference organization.id without ON DELETE CASCADE.
    // Order matters where rows have child cascades inside the same delete.
    await tx
      .delete(schema.procedureProposalDecisions)
      .where(eq(schema.procedureProposalDecisions.organizationId, organizationId));
    await tx
      .delete(schema.procedureProposals)
      .where(eq(schema.procedureProposals.organizationId, organizationId));
    await tx
      .delete(schema.procedureEpisodes)
      .where(eq(schema.procedureEpisodes.organizationId, organizationId));
    await tx.delete(schema.skillRuns).where(eq(schema.skillRuns.organizationId, organizationId));
    await tx
      .delete(schema.skillLabels)
      .where(eq(schema.skillLabels.organizationId, organizationId));
    await tx
      .delete(schema.publishedSkills)
      .where(eq(schema.publishedSkills.organizationId, organizationId));
    await tx.delete(schema.skills).where(eq(schema.skills.organizationId, organizationId));
    await tx.delete(schema.chunks).where(eq(schema.chunks.organizationId, organizationId));
    await tx
      .delete(schema.sourceArtifacts)
      .where(eq(schema.sourceArtifacts.organizationId, organizationId));
    await tx.delete(schema.sources).where(eq(schema.sources.organizationId, organizationId));
    await tx
      .delete(schema.connectorCursors)
      .where(eq(schema.connectorCursors.organizationId, organizationId));
    await tx
      .delete(schema.connectorAllowlists)
      .where(eq(schema.connectorAllowlists.organizationId, organizationId));
    await tx
      .delete(schema.connectorCredentials)
      .where(eq(schema.connectorCredentials.organizationId, organizationId));
    await tx
      .delete(schema.connectorServiceAccounts)
      .where(eq(schema.connectorServiceAccounts.organizationId, organizationId));
    await tx
      .delete(schema.mcpInvocations)
      .where(eq(schema.mcpInvocations.organizationId, organizationId));
    await tx.delete(schema.apiTokens).where(eq(schema.apiTokens.organizationId, organizationId));
    await tx
      .delete(schema.auditEvents)
      .where(eq(schema.auditEvents.organizationId, organizationId));
    await tx
      .delete(schema.customTools)
      .where(eq(schema.customTools.organizationId, organizationId));
    await tx
      .delete(schema.oauthClients)
      .where(eq(schema.oauthClients.organizationId, organizationId));

    // Detach this org from any session that still points at it; the FK is
    // ON DELETE SET NULL so this is belt-and-suspenders, but explicit
    // matters for sessions belonging to other users we don't want to log out.
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.activeOrganizationId, organizationId));

    // Pin the caller's own session to the next valid org so the immediate
    // redirect to /dashboard renders the new active workspace without the
    // layout having to reconcile + bounce.
    const sessionRow = session.session as { id: string };
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: nextActiveOrgId })
      .where(eq(schema.session.id, sessionRow.id));

    // Remaining tables (member, invitation, sync_runs, github_installations,
    // oauth tokens/codes, slack_user_credentials, user_subjects_cache) all
    // cascade on organization delete.
    await tx.delete(schema.organization).where(
      and(
        eq(schema.organization.id, organizationId),
        // Defensive: ensure we never wipe the default org by id reuse.
        ne(schema.organization.id, defaultOrgId),
      ),
    );
  });

  revalidatePath('/');
  redirect('/dashboard');
}

export async function leaveWorkspace(
  _prev: LeaveWorkspaceState,
  formData: FormData,
): Promise<LeaveWorkspaceState> {
  const parsed = leaveWorkspaceSchema.safeParse({
    organizationId: formData.get('organizationId'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { organizationId } = parsed.data;

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
    .select({ id: schema.member.id, role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!me) {
    return { ok: false, error: 'You are not a member of this workspace.' };
  }
  if (me.role === 'owner') {
    return {
      ok: false,
      error:
        "Owners can't leave their own workspace. Transfer ownership first or delete the workspace.",
    };
  }

  // Audit before delete — the row will be gone afterward and we want the
  // event scoped to the org the user is leaving.
  emitAuditEvent({
    db,
    organizationId,
    userId,
    eventType: 'member.left',
    resourceType: 'member',
    resourceId: me.id,
    meta: { role: me.role },
  });

  await db.transaction(async (tx) => {
    await tx.delete(schema.member).where(eq(schema.member.id, me.id));

    // Pick the next active org from remaining memberships, if any. The (app)
    // layout reconciles activeOrganizationId on the next request, but doing
    // this here avoids a flash of the now-inaccessible workspace.
    const remaining = await tx
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1);
    const nextActive = remaining[0]?.organizationId ?? null;

    const sessionRow = session.session as { id: string };
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: nextActive })
      .where(eq(schema.session.id, sessionRow.id));
  });

  revalidatePath('/');
  redirect('/dashboard');
}
