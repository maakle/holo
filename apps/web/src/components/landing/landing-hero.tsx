import Link from 'next/link';
import Image from 'next/image';
import { Activity, Plug, Star } from 'lucide-react';
import { InstallPill } from '@/components/install-pill';
import { ConnectorLogo } from '@/components/connector-logo';
import { GithubMark } from '@/components/landing/brand-marks';
import type { ConnectorMeta } from '@/lib/connector-registry';

const GITHUB_URL = 'https://github.com/maakle/holo';

type ToolRow = {
  id: ConnectorMeta['id'];
  name: string;
  calls: string;
  active: boolean;
};

const TOOL_ROWS: ToolRow[] = [
  { id: 'github', name: 'GitHub', calls: '2,481', active: true },
  { id: 'slack', name: 'Slack', calls: '1,204', active: true },
  { id: 'notion', name: 'Notion', calls: '  894', active: true },
  { id: 'linear', name: 'Linear', calls: '  612', active: true },
  { id: 'googledrive', name: 'Drive', calls: '  408', active: false },
];

type AgentRow = {
  name: string;
  protocol: string;
  color: string;
  status: 'success' | 'accent' | 'muted';
};

const AGENT_ROWS: AgentRow[] = [
  { name: 'Claude', protocol: 'MCP', color: '#cc7c5e', status: 'success' },
  { name: 'Cursor', protocol: 'MCP', color: '#5e5e5e', status: 'success' },
  { name: 'ChatGPT', protocol: 'OpenAPI', color: '#10a37f', status: 'success' },
  { name: 'n8n', protocol: 'REST', color: '#ea4b71', status: 'accent' },
  { name: 'Custom', protocol: 'OpenAPI', color: 'var(--accent)', status: 'muted' },
];

function StatusDot({ status }: { status: AgentRow['status'] }) {
  const colorMap = {
    success: 'bg-success',
    accent: 'bg-accent',
    muted: 'bg-text-subtle',
  } as const;
  return <span className={`h-1.5 w-1.5 flex-none rounded-full ${colorMap[status]}`} aria-hidden />;
}

function HeroDiagram() {
  return (
    <div className="relative">
      <div className="grid items-center gap-5" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
        {/* Tools column */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="caption text-[10px] text-text-subtle">Tools · 5 of 20</span>
            <Plug className="h-3 w-3 text-text-subtle" aria-hidden />
          </div>
          {TOOL_ROWS.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
            >
              <span className="inline-flex h-5.5 w-5.5 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2">
                <ConnectorLogo id={t.id} className="h-3.5 w-3.5 object-contain" />
              </span>
              <span className="flex-1 truncate text-[12.5px] text-text">{t.name}</span>
              <span className="font-mono text-[10.5px] text-text-subtle">{t.calls}</span>
              <span
                className={`h-1.5 w-1.5 flex-none rounded-full bg-success ${
                  t.active ? 'opacity-100' : 'opacity-40'
                }`}
                aria-hidden
              />
            </div>
          ))}
        </div>

        {/* Holo cube center */}
        <div className="relative flex flex-col items-center gap-2">
          <div className="relative flex h-22 w-22 items-center justify-center">
            <div
              className="absolute -inset-1 rounded-full border"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                animation: 'pulse-ring 2.4s cubic-bezier(0.16,1,0.3,1) infinite',
              }}
              aria-hidden
            />
            <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border-strong bg-surface">
              <Image
                src="/logo.png"
                alt=""
                width={30}
                height={30}
                className="h-[30px] w-[30px] object-contain dark:invert"
                aria-hidden
              />
            </div>
          </div>
          <span className="caption text-[10px] text-text-muted">Context layer</span>
          <div className="mt-0.5 flex gap-1.5">
            <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
              MCP
            </span>
            <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
              REST
            </span>
          </div>
        </div>

        {/* Agents column */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="caption text-[10px] text-text-subtle">Agents · live</span>
            <Activity className="h-3 w-3 text-text-subtle" aria-hidden />
          </div>
          {AGENT_ROWS.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
            >
              <span
                className="inline-flex h-5.5 w-5.5 items-center justify-center rounded-sm border border-border"
                style={{ background: a.color }}
              >
                <span className="font-display text-[10px] font-bold text-white">
                  {a.name[0]}
                </span>
              </span>
              <span className="flex-1 truncate text-[12.5px] text-text">{a.name}</span>
              <span className="font-mono text-[10.5px] text-text-subtle">{a.protocol}</span>
              <StatusDot status={a.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LandingHero({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section id="top" className="relative border-b border-border">
      {/* Hero grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          WebkitMaskImage:
            'radial-gradient(ellipse at center top, black 20%, transparent 70%)',
          maskImage: 'radial-gradient(ellipse at center top, black 20%, transparent 70%)',
        }}
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-[1280px] items-center gap-16 px-8 pt-22 pb-24 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-5 inline-flex h-[30px] items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12px] font-medium text-text"
          >
            <Star className="h-3.5 w-3.5" aria-hidden />
            <span>v0.1 · Pre-alpha</span>
            <span className="h-3.5 w-px bg-border" aria-hidden />
            <span className="text-text-muted">MIT</span>
          </a>
          <h1
            className="font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(44px, 6.4vw, 80px)',
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              textWrap: 'balance',
            }}
          >
            The agent context layer for your company.
          </h1>
          <p className="mt-6 max-w-[540px] text-[17px] leading-[1.55] text-text-muted">
            Connect your tools once. Serve every agent over MCP or OpenAPI.{' '}
            <span className="text-text">
              The knowledge layer every agent in your company relies on.
            </span>
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={isAuthed ? '/dashboard' : '/sign-in'}
              className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              {isAuthed ? 'Open dashboard' : 'Get started'}
            </Link>
            <a
              href={GITHUB_URL}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border bg-surface px-6 text-[14px] font-medium text-text transition-colors hover:border-border-strong"
            >
              <GithubMark className="h-4 w-4" />
              View on GitHub
            </a>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-4">
            <InstallPill command="docker compose up" />
            <span className="text-[12px] text-text-subtle">
              localhost:3000 in 60 seconds
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <HeroDiagram />
        </div>
      </div>
    </section>
  );
}
