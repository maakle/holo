import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerAuth } from '@/lib/server-context';
import { ProfileForm } from '@/components/profile-form';

export default async function ProfilePage() {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <h1 className="font-display text-[20px] font-medium tracking-tight text-text">
          Profile
        </h1>
        <p className="mt-1 text-[13px] text-text-subtle">
          Update how your name appears across holo.
        </p>
      </div>
      <ProfileForm
        initialName={session.user.name ?? ''}
        email={session.user.email}
      />
    </div>
  );
}
