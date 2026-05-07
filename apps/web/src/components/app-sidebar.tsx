'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Plug,
  Activity,
  ScrollText,
  Users,
  Terminal,
  Settings,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher, type OrgSummary } from '@/components/org-switcher';
import { UserMenu } from '@/components/user-menu';
import { HoloLogo } from '@/components/logo';
import { SampleDataNavIndicator } from '@/components/sample-data-nav-indicator';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

// Skills (manual labeling, synthesis, runs, marketplace) and procedure auto-discovery
// are deferred from the MVP. See README roadmap. Implementation lives in git history
// (most recently on branch `feat/procedure-auto-discovery`) and in
// packages/discovery/, packages/skills/, and apps/web/src/lib/synthesize-and-persist.ts.
const sections: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
      { href: '/connections', label: 'Connections', icon: Plug },
    ],
  },
  {
    label: 'Agent runtime',
    items: [
      { href: '/observability', label: 'Observability', icon: Activity },
      { href: '/connect-agent', label: 'Connect agent', icon: Terminal },
      { href: '/chat', label: 'Chat', icon: MessageSquare },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/team', label: 'Team', icon: Users },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppSidebar({
  userEmail,
  userName,
  orgs,
  activeOrgId,
  sampleDataActive,
}: {
  userEmail?: string | null;
  userName?: string | null;
  orgs: OrgSummary[];
  activeOrgId: string;
  sampleDataActive: boolean;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="hidden lg:flex w-[256px] shrink-0 flex-col border-r border-border bg-bg"
      aria-label="Primary"
    >
      {/* Brand */}
      <Link
        href="/dashboard"
        aria-label="holo home"
        className="flex h-14 items-center border-b border-border px-4 text-text"
      >
        <HoloLogo />
      </Link>

      {/* Org switcher */}
      <div className="px-2 pt-3 pb-2">
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {sections.map((section, idx) => (
          <div key={idx} className={cn(idx > 0 && 'mt-5')}>
            {section.label ? (
              <div className="caption px-2 pb-2">{section.label}</div>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/dashboard' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-micro',
                        active
                          ? 'bg-surface-2 text-text font-medium'
                          : 'text-text-muted hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-accent' : 'text-text-subtle group-hover:text-text-muted',
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <SampleDataNavIndicator initialActive={sampleDataActive} />

      {/* User block */}
      {userEmail ? (
        <div className="border-t border-border">
          <UserMenu email={userEmail} name={userName} />
        </div>
      ) : null}
    </aside>
  );
}
