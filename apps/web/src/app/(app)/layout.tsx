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

  // Reconcile session.activeOrganizationId against actual memberships. better-auth's
  // removeMember does not clear activeOrganizationId for the user being removed
  // (only for self-removal), so an orphaned session can keep pointing at an org
  // they're no longer in and silently leak that org's data through resolveActiveOrgId.
  const sessionRow = session.session as { id: string; activeOrganizationId?: string | null };
  const sessionActive = sessionRow.activeOrganizationId ?? null;
  const isActiveValid = !!sessionActive && memberOrgs.some((o) => o.id === sessionActive);
  const needsReconciliation =
    !isActiveValid && (sessionActive !== null || memberOrgs.length > 0);

  if (needsReconciliation) {
    const newActive = memberOrgs[0]?.id ?? null;
    await db
      .update(schema.session)
      .set({ activeOrganizationId: newActive })
      .where(eq(schema.session.id, sessionRow.id));
    redirect(memberOrgs.length === 0 ? '/workspaces/new' : '/dashboard');
  }

  // After reconciliation: either we have a valid active membership, or we're
  // orphaned (no memberships, sessionActive already null) — second case lets
  // /workspaces/new render without redirect-looping.
  const activeOrgId: string | null = isActiveValid ? sessionActive : null;

  const sampleDataActive = activeOrgId
    ? (
        await db
          .select({ id: schema.sources.id })
          .from(schema.sources)
          .where(
            and(
              eq(schema.sources.organizationId, activeOrgId),
              eq(schema.sources.provider, SAMPLE_PROVIDER),
            ),
          )
          .limit(1)
      ).length > 0
    : false;

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
