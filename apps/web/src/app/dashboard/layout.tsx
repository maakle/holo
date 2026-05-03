import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getServerAuth } from '@/lib/server-context';
import { SignOutButton } from '@/components/sign-out-button';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-semibold">
              holo
            </Link>
            <Link href="/dashboard" className="text-sm text-gray-600 dark:text-gray-300">
              Overview
            </Link>
            <Link href="/connections" className="text-sm text-gray-600 dark:text-gray-300">
              Connections
            </Link>
            <Link href="/dashboard/team" className="text-sm text-gray-600 dark:text-gray-300">
              Team
            </Link>
            <Link
              href="/dashboard/connect-agent"
              className="text-sm text-gray-600 dark:text-gray-300"
            >
              Connect agent
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{session.user.email}</span>
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
