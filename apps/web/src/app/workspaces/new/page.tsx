import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { HoloLogo } from '@/components/logo';
import { CreateWorkspaceForm } from './create-workspace-form';

export const dynamic = 'force-dynamic';

// This page lives outside the (app) layout on purpose. When a user has zero
// workspace memberships, the (app) layout redirects them here — if this page
// were also inside (app), that redirect would loop forever. The trade-off is
// that we render no sidebar / topbar, which is appropriate for an orphan or
// brand-new user who has nothing to navigate to anyway.
export default async function NewWorkspacePage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/sign-in?callbackURL=/workspaces/new');
  }

  // If the user is already a member of a workspace, route them back into the
  // app instead of letting them stack up workspaces by accident.
  const existing = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.userId, session.user.id))
    .limit(1);
  if (existing[0]) {
    redirect('/dashboard');
  }

  return (
    <main className="relative flex min-h-screen flex-col bg-bg text-text">
      <header className="px-6 py-4">
        <Link href="/" aria-label="holo home" className="text-text">
          <HoloLogo />
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-xl space-y-8">
          <header className="flex flex-col gap-2">
            <span className="caption">Workspaces</span>
            <h1 className="font-display text-h1 font-semibold tracking-tight">
              Create a workspace
            </h1>
            <p className="text-[15px] leading-6 text-text-muted">
              A workspace is your team&apos;s isolated boundary — its own connectors, members,
              tokens, audit log, and billing. You&apos;ll be the owner.
            </p>
          </header>
          <CreateWorkspaceForm />
        </div>
      </div>
    </main>
  );
}
