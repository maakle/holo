import { redirect } from 'next/navigation';
import { InviteShell } from '@/components/invite-shell';
import { joinViaInviteLink } from '@/app/(app)/settings/team/actions';

export const dynamic = 'force-dynamic';

export default async function JoinViaLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const result = await joinViaInviteLink(token);

  if (!result.ok) {
    if (result.reason === 'no_session') {
      redirect(`/sign-in?callbackURL=${encodeURIComponent(`/join/${token}`)}`);
    }
    if (result.reason === 'invalid_token') {
      return (
        <InviteShell
          title="This invite link isn't active"
          body="The link is no longer valid. Ask the workspace owner to send you a fresh one."
        />
      );
    }
    return (
      <InviteShell
        title="We couldn't add you to the workspace"
        body={result.error ?? 'Something went wrong. Try again or ask the inviter to resend.'}
        action={{ label: 'Back to dashboard', href: '/dashboard' }}
      />
    );
  }

  redirect(result.alreadyMember ? '/dashboard' : '/dashboard?joined=1');
}
