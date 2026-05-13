'use client';

import { useState } from 'react';
import { FileLock2, KeyRound, ScrollText, ServerCog } from 'lucide-react';
import { cn } from '@/lib/utils';

type Row = {
  key: string;
  title: string;
  icon: typeof KeyRound;
  body: string;
  meta: string[];
};

const ROWS: readonly Row[] = [
  {
    key: 'vpc',
    title: 'Runs in your VPC.',
    icon: ServerCog,
    body: 'Self-hostable from day one. Your data, your agents, your network. Deploy on Kubernetes, ECS, or a single VM. No outbound dependency on a holo control plane.',
    meta: ['Single-tenant', 'On-premise', 'Air-gapped'],
  },
  {
    key: 'acl',
    title: 'ACL-aware ingestion.',
    icon: KeyRound,
    body: 'Source-system permissions carry through to retrieval. An agent only sees what the asking user is allowed to see — enforced at query time, not at upload.',
    meta: ['Per-user scope', 'Per-agent allowlists', 'Row-level filters'],
  },
  {
    key: 'audit',
    title: 'Per-call audit log.',
    icon: ScrollText,
    body: 'Every tool invocation is attributable and replayable. Agent, user, records touched, latency, result. Stream to your SIEM or query in-app.',
    meta: ['Full payload capture', 'Replay any past call', 'SIEM-ready'],
  },
  {
    key: 'license',
    title: 'MIT core. Enterprise add-ons.',
    icon: FileLock2,
    body: 'Community Edition is MIT — always free to self-host, fork, and ship on. Enterprise Edition adds SSO, RBAC, query history, and whitelabeling for teams that need it.',
    meta: ['SSO / SCIM', 'RBAC', 'Whitelabel'],
  },
] as const;

const DEFAULT_ROW = ROWS[0]!;

export function SecurityPanel() {
  const [activeKey, setActiveKey] = useState<string>(DEFAULT_ROW.key);
  const active = ROWS.find((r) => r.key === activeKey) ?? DEFAULT_ROW;

  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-6 py-20 md:grid-cols-[1fr_1.4fr] md:gap-16">
        <div className="md:sticky md:top-24 md:self-start">
          <p className="caption text-text-subtle">Enterprise ready</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            Security &amp; compliance.
          </h2>
          <p className="mt-4 max-w-[420px] text-[15px] leading-6 text-text-muted">
            Holo is the boring kind of infrastructure: predictable, inspectable,
            and yours to run. Built for teams that can&apos;t hand their data
            to a black box.
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div role="tablist" aria-label="Security capabilities" className="divide-y divide-border">
            {ROWS.map((row) => {
              const isActive = row.key === active.key;
              const Icon = row.icon;
              return (
                <button
                  key={row.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`sec-panel-${row.key}`}
                  id={`sec-tab-${row.key}`}
                  onClick={() => setActiveKey(row.key)}
                  className={cn(
                    'flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors md:px-6 md:py-5',
                    isActive
                      ? 'bg-surface-2 text-text'
                      : 'text-text hover:bg-surface-2/60'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors',
                        isActive
                          ? 'border-border-strong text-text'
                          : 'border-border text-text-muted'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="font-display text-[15px] font-semibold tracking-tight md:text-[16px]">
                      {row.title}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full transition-colors',
                      isActive ? 'bg-accent' : 'bg-transparent'
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div
            id={`sec-panel-${active.key}`}
            role="tabpanel"
            aria-labelledby={`sec-tab-${active.key}`}
            className="border-t border-border bg-surface-2/40 px-5 py-5 md:px-6 md:py-6"
          >
            <p className="text-[14px] leading-6 text-text-muted">{active.body}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {active.meta.map((m) => (
                <li
                  key={m}
                  className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] text-text-subtle"
                >
                  {m}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
