'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type Tab = {
  href: string;
  label: string;
};

export function SettingsTabsNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="inline-flex h-10 items-center gap-1 border-b border-border"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href ||
          (tab.href !== '/settings' && pathname.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            className={cn(
              'relative inline-flex h-10 items-center whitespace-nowrap px-3 text-[13px] font-medium',
              'transition-colors duration-micro ease-enter',
              'focus-visible:outline-hidden',
              active ? 'text-text' : 'text-text-muted hover:text-text',
              'after:absolute after:inset-x-3 after:-bottom-px after:h-px',
              active ? 'after:bg-accent' : 'after:bg-transparent',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
