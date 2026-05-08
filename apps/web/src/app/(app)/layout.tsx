import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { and, eq } from 'drizzle-orm';
import { schema, SAMPLE_PROVIDER } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { auth, db} = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const memberOrgs = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(eq(schema.member.userId, session.user.id));

  // Orphaned user — no workspace memberships at all. Send them to the
  // top-level /workspaces/new page (which lives outside (app), so this
  // redirect won't loop). Without this guard, (app) pages call
  // resolveActiveOrgId and silently fall through to user.organizationId
  // (the seeded default org), leaking that workspace's data to a viewer
  // who isn't a member.
  if (memberOrgs.length === 0) {
    redirect('/workspaces/new');
  }

  // Reconcile session.activeOrganizationId against actual memberships.
  // better-auth's removeMember does not clear activeOrganizationId for the
  // user being removed (only for self-removal), so an admin removing
  // someone leaves their session pointing at the ex-workspace.
  const sessionRow = session.session as { id: string; activeOrganizationId?: string | null };
  const sessionActive = sessionRow.activeOrganizationId ?? null;
  const isActiveValid = !!sessionActive && memberOrgs.some((o) => o.id === sessionActive);

  if (!isActiveValid) {
    const newActive = memberOrgs[0]!.id;
    await db
      .update(schema.session)
      .set({ activeOrganizationId: newActive })
      .where(eq(schema.session.id, sessionRow.id));
    redirect('/dashboard');
  }

  const activeOrgId = sessionActive!;

  const sampleSourceRows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, activeOrgId),
        eq(schema.sources.provider, SAMPLE_PROVIDER),
      ),
    )
    .limit(1);
  const sampleDataActive = sampleSourceRows.length > 0;

  return (
    <div className="flex h-screen bg-bg text-text">
      <AppSidebar
        userEmail={session.user.email}
        userName={session.user.name}
        orgs={memberOrgs}
        activeOrgId={activeOrgId}
        sampleDataActive={sampleDataActive}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-[1280px] [&:has([data-fullwidth])]:max-w-none [&:has([data-fullheight])]:flex [&:has([data-fullheight])]:h-full [&:has([data-fullheight])]:flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
