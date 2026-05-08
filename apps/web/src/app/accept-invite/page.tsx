import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InviteShell } from '@/components/invite-shell';
import { getServerContext } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id) {
    return (
      <InviteShell
        title="Invite link is missing an id"
        body="The link you followed didn't include an invitation id. Ask the inviter to resend."
      />
    );
  }

  const { auth } = await getServerContext();
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });

  if (!session) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(`/accept-invite?id=${id}`)}`);
  }

  try {
    await auth.api.acceptInvitation({
      body: { invitationId: id },
      headers: reqHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not accept this invitation.';
    return (
      <InviteShell
        title="We couldn't accept the invite"
        body={message}
        action={{ label: 'Back to dashboard', href: '/dashboard' }}
      />
    );
  }

  redirect('/dashboard?accepted=1');
}
