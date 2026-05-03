import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
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

function InviteShell({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg text-text">
      <header className="px-6 py-4">
        <Link href="/" className="font-display text-[15px] font-semibold tracking-tight">
          holo
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm space-y-6 text-center">
          <h1 className="font-display text-h1 font-semibold tracking-tight">{title}</h1>
          <p className="text-[13px] leading-5 text-text-muted">{body}</p>
          <Button asChild variant="outline">
            <Link href={action?.href ?? '/'}>{action?.label ?? 'Back to home'}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
