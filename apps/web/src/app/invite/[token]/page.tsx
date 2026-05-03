import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const sessionUser = session.user as unknown as {
    id: string;
    email: string;
    organizationId: string;
  };

  const invites = await db
    .select()
    .from(schema.invitation)
    .where(eq(schema.invitation.token, token));
  const invite = invites[0];

  if (!invite) {
    return <InviteState title="Invite not found" body="This link is invalid or has been revoked." />;
  }
  if (invite.status !== 'pending') {
    return (
      <InviteState
        title="Invite already used"
        body={`This invitation was ${invite.status}. Ask the workspace admin for a fresh link.`}
      />
    );
  }
  if (invite.expiresAt < new Date()) {
    await db
      .update(schema.invitation)
      .set({ status: 'expired' })
      .where(eq(schema.invitation.id, invite.id));
    return (
      <InviteState
        title="Invite expired"
        body="Invites expire after 7 days. Ask the workspace admin for a fresh link."
      />
    );
  }

  // Accept: insert member-row idempotently, switch active org, mark invitation accepted.
  await db
    .insert(schema.member)
    .values({
      organizationId: invite.organizationId,
      userId: sessionUser.id,
      role: invite.role,
    })
    .onConflictDoNothing({ target: [schema.member.organizationId, schema.member.userId] });

  await db
    .update(schema.user)
    .set({ organizationId: invite.organizationId, updatedAt: new Date() })
    .where(eq(schema.user.id, sessionUser.id));

  await db
    .update(schema.invitation)
    .set({ status: 'accepted' })
    .where(
      and(eq(schema.invitation.id, invite.id), eq(schema.invitation.status, 'pending')),
    );

  redirect('/dashboard');
}

function InviteState({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="font-display text-h1">{title}</h1>
        <p className="text-body-sm text-text-muted">{body}</p>
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center rounded-md border border-border px-5 text-body-sm font-medium text-text hover:border-border-strong"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
