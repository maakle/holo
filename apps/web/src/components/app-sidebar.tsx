'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Plug,
  Sparkles,
  Activity,
  ScrollText,
  Users,
  Terminal,
  History,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/org-switcher';
import { UserMenu } from '@/components/user-menu';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

const sections: NavSection[] = [
  {
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
      { href: '/connections', label: 'Connections', icon: Plug },
      { href: '/skills', label: 'Skills', icon: Sparkles },
    ],
  },
  {
    label: 'Agent runtime',
    items: [
      { href: '/observability', label: 'Observability', icon: Activity },
      { href: '/skills/runs', label: 'Skill runs', icon: History },
      { href: '/connect-agent', label: 'Connect agent', icon: Terminal },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard/team', label: 'Team', icon: Users },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
];

export function AppSidebar({
  userEmail,
  userName,
}: {
  userEmail?: string | null;
  userName?: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside
      className="hidden lg:flex w-[256px] shrink-0 flex-col border-r border-border bg-bg"
      aria-label="Primary"
    >
      {/* Org switcher */}
      <div className="px-2 pt-3 pb-2">
        <OrgSwitcher name="holo" />
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

      {/* User block */}
      {userEmail ? (
        <div className="border-t border-border">
          <UserMenu email={userEmail} name={userName} />
        </div>
      ) : null}
    </aside>
  );
}
