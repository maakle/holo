'use client';

import { usePathname } from 'next/navigation';

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/connections': 'Connections',
  '/observability': 'Observability',
  '/connect-agent': 'Connect agent',
  '/dashboard/team': 'Team',
  '/audit': 'Audit log',
  '/profile': 'Profile',
};

function titleFromPath(pathname: string): string {
  const exact = TITLES[pathname];
  if (exact) return exact;
  const prefix = Object.keys(TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? TITLES[prefix]! : 'holo';
}

export function AppTopbar() {
  const pathname = usePathname();
  const title = titleFromPath(pathname);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-center border-b border-border bg-bg/90 px-4 backdrop-blur-sm supports-backdrop-filter:bg-bg/70">
      <div className="font-display text-[14px] font-medium tracking-tight text-text">
        {title}
      </div>
    </header>
  );
}
