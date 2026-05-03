'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { authClient } from '@holo/auth/client';
import { cn } from '@/lib/utils';

export type OrgSummary = { id: string; name: string; slug: string };

export function OrgSwitcher({
  orgs: initialOrgs,
  activeOrgId,
}: {
  orgs: OrgSummary[];
  activeOrgId: string;
}) {
  const router = useRouter();
  const [orgs, setOrgs] = useState(initialOrgs);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const display = active?.name ?? 'holo';
  const initial = display.charAt(0).toLowerCase();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Refresh the list lazily when the menu opens — initialOrgs come from SSR
  // and may be stale if the user accepted an invite in another tab.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    authClient.organization
      .list()
      .then((res) => {
        if (cancelled) return;
        const data = (res?.data ?? []) as OrgSummary[];
        if (data.length) setOrgs(data);
      })
      .catch(() => {
        // Silent — the SSR list is already shown.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function switchTo(orgId: string) {
    if (orgId === activeOrgId) {
      setOpen(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await authClient.organization.setActive({ organizationId: orgId });
      if (res?.error) {
        setError(res.error.message ?? 'Could not switch organization.');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Switch organization"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-micro hover:bg-surface-2"
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-text"
          aria-hidden
        >
          <span className="font-display text-[14px] font-semibold leading-none text-bg">
            {initial}
          </span>
        </div>
        <span className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold tracking-tight text-text">
          {display}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-bg p-1 shadow-lg"
        >
          <div className="caption px-2 pb-1 pt-1.5 text-text-subtle">Workspaces</div>
          <ul className="space-y-0.5">
            {orgs.map((org) => {
              const isActive = org.id === activeOrgId;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => switchTo(org.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-micro',
                      isActive
                        ? 'bg-surface-2 text-text'
                        : 'text-text-muted hover:bg-surface-2 hover:text-text',
                      pending && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <div
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-text/90"
                      aria-hidden
                    >
                      <span className="font-display text-[10px] font-semibold leading-none text-bg">
                        {org.name.charAt(0).toLowerCase()}
                      </span>
                    </div>
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {isActive ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-1 border-t border-border" />

          <Link
            role="menuitem"
            href="/workspaces/new"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <Plus className="h-3.5 w-3.5 text-text-subtle" />
            Create workspace
          </Link>

          {error ? (
            <div className="px-2 pb-1 pt-1 text-[11px] text-error">{error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
