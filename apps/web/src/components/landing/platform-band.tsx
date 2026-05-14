import { Plus, Search, ShieldCheck, Terminal, Zap } from 'lucide-react';

type SearchHit = {
  source: string;
  score: string;
  snippet: string;
};

const SEARCH_HITS: SearchHit[] = [
  { source: 'GitHub', score: '0.92', snippet: 'packages/auth/saml.ts — SAML SSO handler' },
  { source: 'Notion', score: '0.88', snippet: 'Enterprise plan · SSO enabled by default' },
  { source: 'Linear', score: '0.84', snippet: 'PLAT-412 — Okta integration shipped Q3' },
  {
    source: 'Salesforce',
    score: '0.79',
    snippet: 'Acme deal: SSO blocker resolved 2024-10',
  },
];

function ContextMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Search className="h-3 w-3 text-text-subtle" aria-hidden />
        <span className="flex-1 truncate font-mono text-[12px] text-text-muted">
          &quot;does our product support SSO?&quot;
        </span>
        <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
          top 5
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[10.5px] text-text-subtle">
        <span className="font-mono">vector + tsvector · 13 connectors</span>
        <span className="ml-auto font-mono text-success">78ms</span>
      </div>
      {SEARCH_HITS.map((hit) => (
        <div
          key={hit.source}
          className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0"
        >
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded-sm border border-border bg-surface-2 px-1.5 py-px font-mono text-[10px] text-text-subtle">
              {hit.source}
            </span>
            <span className="font-mono text-text-subtle">{hit.score}</span>
            <span className="ml-auto h-1 w-1 rounded-full bg-success" aria-hidden />
          </div>
          <p className="truncate text-[11.5px] leading-4 text-text-muted">{hit.snippet}</p>
        </div>
      ))}
    </div>
  );
}

const TOOLS = [
  { name: 'search', args: 'q, topK', calls: '2,481' },
  { name: 'get_deal', args: 'id', calls: '  894' },
  { name: 'draft_support_reply', args: 'ticket', calls: '  612' },
  { name: 'answer_security_q', args: 'doc', calls: '  281' },
];

function ProceduresMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Terminal className="h-3 w-3 text-text-subtle" aria-hidden />
        <span className="font-mono text-[11px] text-text-muted">tools/list</span>
        <span className="ml-auto rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
          MCP
        </span>
      </div>
      {TOOLS.map((t) => (
        <div
          key={t.name}
          className="flex items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0"
        >
          <span
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm"
            style={{
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
              color: 'var(--accent)',
            }}
          >
            <Zap className="h-2 w-2" aria-hidden />
          </span>
          <span className="font-mono text-[12px] text-text">{t.name}</span>
          <span className="font-mono text-[11px] text-text-subtle">({t.args})</span>
          <span className="ml-auto font-mono text-[11px] text-text-subtle">{t.calls}</span>
        </div>
      ))}
      <div className="flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] text-text-subtle">
        <Plus className="h-2.5 w-2.5" aria-hidden /> learn new procedure from chat history
      </div>
    </div>
  );
}

type AuditRow = {
  agent: string;
  user: string;
  tool: string;
  scope: string;
  ok: boolean;
  t: string;
};

const AUDIT_ROWS: AuditRow[] = [
  { agent: 'Claude', user: 'm.ross', tool: 'search', scope: 'sales', ok: true, t: '14:02:11' },
  { agent: 'Cursor', user: 'j.lee', tool: 'get_repo', scope: 'eng', ok: true, t: '14:02:08' },
  {
    agent: 'ChatGPT',
    user: 'p.shah',
    tool: 'search',
    scope: 'support',
    ok: true,
    t: '14:02:03',
  },
  {
    agent: 'n8n',
    user: 'svc.cron',
    tool: 'draft_reply',
    scope: 'support',
    ok: false,
    t: '14:01:58',
  },
];

function GovernanceMock() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ShieldCheck className="h-3 w-3 text-text-subtle" aria-hidden />
        <span className="text-[11.5px] text-text-muted">Audit log · last 24h</span>
        <span className="ml-auto font-mono text-[10.5px] text-text-subtle">1,284 calls</span>
      </div>
      {AUDIT_ROWS.map((r, i) => (
        <div
          key={i}
          className={`flex items-center gap-2.5 px-3 py-2 text-[11.5px] ${
            i < AUDIT_ROWS.length - 1 ? 'border-b border-border' : ''
          }`}
        >
          <span
            className={`h-1.5 w-1.5 flex-none rounded-full ${
              r.ok ? 'bg-success' : 'bg-error'
            }`}
            aria-hidden
          />
          <span className="font-mono text-[10.5px] text-text-subtle">{r.t}</span>
          <span className="font-medium text-text">{r.agent}</span>
          <span className="text-text-subtle">·</span>
          <span className="text-text-muted">{r.user}</span>
          <span className="ml-auto font-mono text-[10.5px] text-text-muted">{r.tool}</span>
          <span className="rounded-sm border border-border bg-surface-2 px-1 py-px font-mono text-[9px] text-text-subtle">
            {r.scope}
          </span>
        </div>
      ))}
    </div>
  );
}

const PILLARS = [
  {
    label: 'Context layer',
    title: 'Connect once. Index everything.',
    body: '20 connectors, continuous ACL-aware sync. Hybrid retrieval (vector + full-text) over one source of truth every agent reads.',
    mock: ContextMock,
  },
  {
    label: 'Procedures',
    title: 'Not just search. Callable skills.',
    body: 'Holo learns the procedures your team has proven out and exposes them as MCP-invokable skills. Agents invoke what the company has done before.',
    mock: ProceduresMock,
  },
  {
    label: 'Governance',
    title: 'Scoped access. Full observability.',
    body: 'Allowlist-scoped at ingestion. Every call logged, attributable, replayable. Per-agent tool allowlists and row-level data scopes.',
    mock: GovernanceMock,
  },
];

export function PlatformBand() {
  return (
    <section id="platform" className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="mb-12 max-w-[540px]">
          <p className="caption text-text-subtle">The holo platform</p>
          <h2
            className="mt-3.5 font-display font-semibold text-text"
            style={{
              fontSize: 'clamp(34px, 4vw, 52px)',
              lineHeight: 1.05,
              letterSpacing: '-0.015em',
              textWrap: 'balance',
            }}
          >
            Three things. One layer underneath every agent.
          </h2>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {PILLARS.map((p) => {
            const Mock = p.mock;
            return (
              <div
                key={p.label}
                className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6"
              >
                <div>
                  <p className="caption text-text-subtle">{p.label}</p>
                  <h3 className="mt-2.5 font-display text-[18px] font-semibold leading-tight tracking-tight text-text">
                    {p.title}
                  </h3>
                  <p className="mt-2.5 text-[13.5px] leading-[21px] text-text-muted">
                    {p.body}
                  </p>
                </div>
                <div className="mt-auto">
                  <Mock />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
