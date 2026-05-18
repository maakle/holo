'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  Plug,
  Activity,
  Terminal,
  Settings,
  MessageSquare,
  FolderTree,
  ChevronLeft,
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
  icon?: LucideIcon;
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

// Skills (manual labeling, synthesis, runs, marketplace) and procedure auto-discovery
// are deferred from the MVP. See README roadmap. Implementation lives in git history
// (most recently on branch `feat/procedure-auto-discovery`) and in
// packages/discovery/, packages/skills/, and apps/web/src/lib/synthesize-and-persist.ts.
function buildSections(): NavSection[] {
  return [
    {
      items: [
        { href: '/dashboard', label: 'Overview', icon: LayoutGrid },
        { href: '/connections', label: 'Connections', icon: Plug },
      ],
    },
    {
      label: 'Agent runtime',
      items: [
        { href: '/files', label: 'Files', icon: FolderTree },
        { href: '/observability', label: 'Observability', icon: Activity },
        { href: '/connect-agent', label: 'Connect agent', icon: Terminal },
        { href: '/chat', label: 'Chat', icon: MessageSquare },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { href: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ];
}

function buildSettingsItems(eeEnabled: boolean): NavItem[] {
  return [
    { href: '/settings', label: 'General' },
    { href: '/settings/api-keys', label: 'API keys' },
    { href: '/settings/integrations', label: 'Customization' },
    { href: '/settings/team', label: 'Team' },
    ...(eeEnabled ? [{ href: '/settings/audit-log', label: 'Audit log' }] : []),
  ];
}

export interface SidebarProps {
  userEmail?: string | null;
  userName?: string | null;
  orgs: OrgSummary[];
  activeOrgId: string | null;
  sampleDataActive: boolean;
  eeEnabled: boolean;
}

export function AppSidebar(props: SidebarProps) {
  return (
    <aside
      className="hidden lg:flex w-[256px] shrink-0 flex-col border-r border-border bg-bg"
      aria-label="Primary"
    >
      <SidebarBody {...props} />
    </aside>
  );
}

/**
 * Shared sidebar body — used both by the desktop fixed `<aside>` and by the
 * mobile drawer (`MobileNav`). Kept presentation-agnostic so the same nav
 * structure renders identically in both surfaces.
 */
export function SidebarBody({
  userEmail,
  userName,
  orgs,
  activeOrgId,
  sampleDataActive,
  eeEnabled,
}: SidebarProps) {
  const pathname = usePathname();
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/');

  return (
    <>
      {/* Brand */}
      <Link
        href="/dashboard"
        aria-label="holo home"
        className="flex h-14 items-center border-b border-border px-4 text-text"
      >
        <HoloLogo />
      </Link>

      {/* Sliding panel container */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className={cn(
            'absolute inset-0 flex w-[200%] transition-transform duration-200 ease-enter',
            inSettings ? '-translate-x-1/2' : 'translate-x-0',
          )}
        >
          <MainPanel
            orgs={orgs}
            activeOrgId={activeOrgId}
            pathname={pathname}
            inert={inSettings}
          />
          <SettingsPanel
            eeEnabled={eeEnabled}
            pathname={pathname}
            inert={!inSettings}
          />
        </div>
      </div>

      <SampleDataNavIndicator initialActive={sampleDataActive} />

      {/* User block */}
      {userEmail ? (
        <div className="border-t border-border">
          <UserMenu email={userEmail} name={userName} />
        </div>
      ) : null}
    </>
  );
}

function MainPanel({
  orgs,
  activeOrgId,
  pathname,
  inert,
}: {
  orgs: OrgSummary[];
  activeOrgId: string | null;
  pathname: string;
  inert: boolean;
}) {
  const sections = buildSections();
  return (
    <div
      className="flex w-1/2 shrink-0 flex-col"
      aria-hidden={inert}
      {...(inert ? { inert: '' as unknown as boolean } : {})}
    >
      <div className="px-2 pt-3 pb-2">
        <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      </div>
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
                      tabIndex={inert ? -1 : 0}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-micro',
                        active
                          ? 'bg-surface-2 text-text font-medium'
                          : 'text-text-muted hover:bg-surface-2 hover:text-text',
                      )}
                    >
                      {Icon ? (
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0',
                            active ? 'text-accent' : 'text-text-subtle group-hover:text-text-muted',
                          )}
                        />
                      ) : null}
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}

function SettingsPanel({
  eeEnabled,
  pathname,
  inert,
}: {
  eeEnabled: boolean;
  pathname: string;
  inert: boolean;
}) {
  const items = buildSettingsItems(eeEnabled);
  return (
    <div
      className="flex w-1/2 shrink-0 flex-col"
      aria-hidden={inert}
      {...(inert ? { inert: '' as unknown as boolean } : {})}
    >
      <div className="px-2 pt-3 pb-2">
        <Link
          href="/dashboard"
          tabIndex={inert ? -1 : 0}
          className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-text-muted transition-colors duration-micro hover:bg-surface-2 hover:text-text"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 text-text-subtle group-hover:text-text-muted" />
          <span className="truncate">Settings</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-0.5">
          {items.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== '/settings' && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  tabIndex={inert ? -1 : 0}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-micro',
                    active
                      ? 'bg-surface-2 text-text font-medium'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
