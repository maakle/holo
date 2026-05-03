import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { auth, db } = await getServerContext();
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

  const sessionRow = session.session as { activeOrganizationId?: string | null };
  const homeOrgId = (session.user as unknown as { organizationId?: string }).organizationId ?? '';
  const activeOrgId = sessionRow.activeOrganizationId ?? homeOrgId;

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <AppSidebar
        userEmail={session.user.email}
        userName={session.user.name}
        orgs={memberOrgs}
        activeOrgId={activeOrgId}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 px-6 py-8 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
