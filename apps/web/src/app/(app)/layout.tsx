import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { getServerAuth } from '@/lib/server-context';
import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  return (
    <div className="flex min-h-screen bg-bg text-text">
      <AppSidebar userEmail={session.user.email} userName={session.user.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 px-6 py-8 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
