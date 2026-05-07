import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { and, eq } from 'drizzle-orm';
import { schema, SAMPLE_PROVIDER } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { auth, db, defaultOrgId } = await getServerContext();
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

  const activeOrgId = resolveActiveOrgId(session, defaultOrgId);

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
          <div className="mx-auto w-full max-w-[1280px] [&:has([data-fullwidth])]:max-w-none">{children}</div>
        </main>
      </div>
    </div>
  );
}
