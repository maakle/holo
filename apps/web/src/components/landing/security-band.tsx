'use client';

import { useState } from 'react';
import { Cloud, Lock, Minus, PackageOpen, Plus, ScrollText, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = {
  id: string;
  Icon: LucideIcon;
  title: string;
  body: string;
  meta: string;
};

const TABS: Tab[] = [
  {
    id: 'vpc',
    Icon: Cloud,
    title: 'Runs in your VPC',
    body: 'Self-host on Kubernetes, ECS, or a single VM. No outbound dependency on a holo control plane. Air-gapped deployments supported.',
    meta: 'kubernetes · ecs · single-vm · air-gapped',
  },
  {
    id: 'acl',
    Icon: Lock,
    title: 'ACL-aware ingestion',
    body: 'Permissions are resolved at sync time, not query time. Holo never indexes a record an agent’s caller cannot see — no row-level leakage downstream.',
    meta: 'per-row scopes · per-agent allowlists',
  },
  {
    id: 'audit',
    Icon: ScrollText,
    title: 'Per-call audit log',
    body: 'Every tool call is logged with agent, user, scope, retrieved records, and full payload. Tamper-evident hash chain. Streams to your SIEM.',
    meta: 'tamper-evident · SIEM-streamable',
  },
  {
    id: 'core',
    Icon: PackageOpen,
    title: 'MIT core. Enterprise add-ons.',
    body: 'Community edition ships every primitive — search, MCP gateway, audit log, multi-tenant orgs. EE adds SSO/SCIM, RBAC, custom hooks, whitelabeling.',
    meta: 'no closed core · same binary',
  },
  {
    id: 'single',
    Icon: Shield,
    title: 'Single-tenant by default',
    body: 'No shared infrastructure. Encryption at rest with your KMS keys. Optional FIPS-validated build. Holo is the boring kind of infrastructure: predictable.',
    meta: 'BYO-KMS · FIPS-validated build',
  },
];

const COMPATIBLE = [
  'Kubernetes',
  'Docker',
  'PostgreSQL · pgvector',
  'BullMQ',
  'OpenTelemetry',
  'Better Auth',
  'SAML / OIDC',
  'SCIM',
];

export function SecurityBand() {
  const [activeId, setActiveId] = useState<string>(TABS[0]!.id);
  const sel = TABS.find((t) => t.id === activeId) ?? TABS[0]!;
  const SelIcon = sel.Icon;
  return (
    <section id="security" className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="mb-12 max-w-[540px]">
          <p className="caption text-text-subtle">Enterprise ready</p>
          <h2
            className="mt-3.5 font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            Security &amp; compliance.
          </h2>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-1">
            {TABS.map((t) => {
              const selected = activeId === t.id;
              const ChevronIcon = selected ? Minus : Plus;
              const TabIcon = t.Icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-selected={selected}
                  onClick={() => setActiveId(t.id)}
                  className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:border-border-strong"
                  style={
                    selected
                      ? {
                          background: 'var(--surface-2)',
                          borderColor: 'var(--border-strong)',
                          boxShadow: 'inset 2px 0 0 var(--accent)',
                        }
                      : undefined
                  }
                >
                  <span
                    className="inline-flex"
                    style={{ color: selected ? 'var(--accent)' : 'var(--text-subtle)' }}
                  >
                    <TabIcon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="flex-1 font-display text-[15px] font-semibold text-text">
                    {t.title}
                  </span>
                  <ChevronIcon className="h-3.5 w-3.5 text-text-subtle" aria-hidden />
                </button>
              );
            })}
          </div>

          <div className="flex min-h-[360px] flex-col justify-between rounded-lg border border-border bg-surface p-8">
            <div>
              <div className="inline-flex items-center gap-2 text-accent">
                <SelIcon className="h-4 w-4" aria-hidden />
                <p className="caption text-accent">{sel.title}</p>
              </div>
              <h3 className="mt-3 font-display text-[26px] font-semibold leading-tight tracking-tight text-text">
                {sel.title}
              </h3>
              <p className="mt-4 text-[15px] leading-[1.55] text-text-muted">{sel.body}</p>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-3.5 border-t border-border pt-6">
              <span className="caption text-text-subtle">Capabilities</span>
              <div className="flex flex-wrap gap-2">
                {sel.meta.split(' · ').map((m) => (
                  <span
                    key={m}
                    className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-text-subtle"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Compatibility strip */}
        <div className="mt-8 flex flex-wrap items-center gap-7 rounded-lg border border-border bg-surface px-6 py-5">
          <p className="caption text-text-subtle">Compatible with</p>
          <div className="flex flex-1 flex-wrap justify-end gap-7">
            {COMPATIBLE.map((s) => (
              <span key={s} className="font-mono text-[12px] text-text-subtle">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
