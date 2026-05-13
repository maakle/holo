import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { DangerZone } from './danger-zone';
import { LeaveWorkspace } from './leave-workspace';
import { Preferences } from './preferences';
import { WorkspaceDetails } from './workspace-details';

export const dynamic = 'force-dynamic';

export default async function SettingsGeneralPage() {
  const { auth, db, defaultOrgId } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

  const [org] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      metadata: schema.organization.metadata,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  if (!org) redirect('/dashboard');

  const hideSampleData = Boolean(
    (org.metadata as { hideSampleData?: boolean } | null)?.hideSampleData,
  );

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, session.user.id),
      ),
    )
    .limit(1);

  const isOwner = me?.role === 'owner';
  const isDefaultOrg = orgId === defaultOrgId;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Workspace details</h2>
        <WorkspaceDetails
          organizationId={org.id}
          name={org.name}
          slug={org.slug}
          role={me?.role ?? '—'}
          isOwner={isOwner}
          isDefaultOrg={isDefaultOrg}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Preferences</h2>
        <Preferences
          organizationId={org.id}
          hideSampleData={hideSampleData}
          isOwner={isOwner}
        />
      </section>

      <LeaveWorkspace
        organizationId={org.id}
        organizationName={org.name}
        canLeave={!!me && me.role !== 'owner'}
        reason={
          !me
            ? 'You are not a member of this workspace.'
            : me.role === 'owner'
              ? 'Owners can’t leave their own workspace. Transfer ownership or delete it instead.'
              : undefined
        }
      />

      <DangerZone
        organizationId={org.id}
        organizationName={org.name}
        canDelete={isOwner && !isDefaultOrg}
        reason={
          isDefaultOrg
            ? 'The default workspace cannot be deleted.'
            : !isOwner
              ? 'Only owners can delete this workspace.'
              : undefined
        }
      />
    </div>
  );
}
