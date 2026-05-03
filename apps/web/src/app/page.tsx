import Link from 'next/link';
import { headers } from 'next/headers';
import { getServerAuth } from '@/lib/server-context';

const GITHUB_URL = 'https://github.com/maakle/holo';
const DOCS_URL = `${GITHUB_URL}#readme`;
const ROADMAP_URL = `${GITHUB_URL}/blob/main/docs/ROADMAP.md`;
const ARCHITECTURE_URL = `${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md`;
const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;

export default async function Home() {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const isAuthed = !!session;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <SiteHeader isAuthed={isAuthed} />
      <Hero isAuthed={isAuthed} />
      <ConnectorsStrip />
      <PillarsBand />
      <CodeShowcase />
      <ObservabilityBand />
      <VisionBand />
      <FinalCTA isAuthed={isAuthed} />
      <SiteFooter />
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────
function SiteHeader({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
        <Link href="/" className="font-display text-[15px] font-semibold tracking-tight">
          holo
        </Link>
        <nav className="flex items-center gap-6">
          <a href={DOCS_URL} className="text-[13px] text-text-muted hover:text-text">
            Docs
          </a>
          <a href={GITHUB_URL} className="text-[13px] text-text-muted hover:text-text">
            GitHub
          </a>
          {isAuthed ? (
            <Link
              href="/dashboard"
              className="text-[13px] font-medium text-text hover:text-accent"
            >
              Dashboard →
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="text-[13px] font-medium text-text hover:text-accent"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

// ── Hero ───────────────────────────────────────────────────────────────────
function Hero({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="relative border-b border-border">
      <BackdropGrid />
      <div className="relative mx-auto max-w-[1024px] px-6 pt-20 pb-20 text-center md:pt-28">
        <p className="caption text-text-subtle">
          Open-source · AGPL-3.0 · Self-hostable
        </p>
        <h1 className="mx-auto mt-6 max-w-[920px] text-balance font-display text-[44px] font-semibold leading-[1.05] tracking-tight md:text-[60px]">
          The agent context layer
          <br />
          for your company.
        </h1>
        <p className="mx-auto mt-6 max-w-[640px] text-balance text-[15px] leading-6 text-text-muted">
          Connect your tools once. Holo unifies the data, learns your team&apos;s repeatable
          procedures, and exposes them as callable tools over MCP and OpenAPI. Bring your own
          agent — Claude, Cursor, ChatGPT, anything — and plug it into the same layer.
          <span className="text-text"> Layer today. Agent OS tomorrow.</span>
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={isAuthed ? '/dashboard' : '/sign-in'}
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            {isAuthed ? 'Open dashboard' : 'Get started'}
          </Link>
          <a
            href={GITHUB_URL}
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-surface px-6 text-[14px] font-medium text-text transition-colors hover:border-border-strong"
          >
            Star on GitHub
          </a>
        </div>
        <p className="mt-6 text-[12px] text-text-subtle">
          Pre-alpha — not yet ready for production traffic.
        </p>
      </div>
    </section>
  );
}

// Subtle backdrop grid behind the hero — geometric, not decorative.
function BackdropGrid() {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"
      aria-hidden
    />
  );
}

// ── Connectors strip ──────────────────────────────────────────────────────
const CONNECTOR_ITEMS = [
  { label: 'Slack', live: true },
  { label: 'GitHub', live: true },
  { label: 'Notion', live: true },
  { label: 'Grain', live: true },
  { label: 'Pylon', live: true },
  { label: 'HubSpot', live: true },
] as const;

function ConnectorsStrip() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 py-10 font-mono text-[13px] text-text-muted">
        {CONNECTOR_ITEMS.map((c) => (
          <span key={c.label}>{c.label.toLowerCase()}</span>
        ))}
      </div>
    </section>
  );
}

// ── Single feature: drop into your agent ──────────────────────────────────
function CodeShowcase() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-10 px-6 py-20 md:grid-cols-2 md:gap-14 md:items-center">
        <div>
          <p className="caption text-text-subtle">Bring your own agent</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            One layer. Every agent. Same procedures.
          </h2>
          <p className="mt-4 text-balance text-[15px] leading-6 text-text-muted">
            MCP for Claude, Cursor, Cline. REST + OpenAPI for ChatGPT Actions, Gemini, n8n.
            Same backend, same data, same learned procedures — the protocol is the agent&apos;s
            choice, not yours.
          </p>
        </div>
        <CodeCard
          title="search.ts"
          lang="ts"
          code={`const { content } = await mcp.callTool('holo', 'search', {
  q: 'how do we onboard a new ATS partner?',
  topK: 5,
});`}
        />
      </div>
    </section>
  );
}

// ── Vision band ───────────────────────────────────────────────────────────
function VisionBand() {
  return (
    <section className="border-b border-border bg-surface-2/40">
      <div className="mx-auto max-w-[820px] px-6 py-16 text-center md:py-20">
        <p className="caption text-text-subtle">Building toward</p>
        <p className="mt-4 text-balance font-display text-[22px] leading-snug tracking-tight text-text md:text-[26px]">
          The <span className="text-accent">AI operating system for companies</span> and the{' '}
          <span className="text-accent">company brain</span> — the queryable context layer
          underneath all your team&apos;s agent operations, and the procedural extraction
          layer that turns scattered artifacts into invokable skills.
        </p>
        <p className="mx-auto mt-4 max-w-[560px] text-[12px] text-text-subtle">
          Two adjacent YC Requests for Startups. Holo is the open-source, self-hostable take.
        </p>
      </div>
    </section>
  );
}

// ── Final CTA ─────────────────────────────────────────────────────────────
function FinalCTA({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1024px] px-6 py-20 text-center md:py-24">
        <h2 className="mx-auto max-w-none text-balance font-display text-[34px] font-semibold leading-tight tracking-tight md:text-[44px]">
          One brain. Every agent. Self-hostable.
        </h2>
        <p className="mx-auto mt-5 max-w-[560px] text-balance text-[15px] leading-6 text-text-muted">
          If your team is already paying the per-agent integration tax, holo is the shared
          context layer that makes it stop. Star the repo, run it locally, or sign in.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={isAuthed ? '/dashboard' : '/sign-in'}
            className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-6 text-[14px] font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            {isAuthed ? 'Open dashboard' : 'Get started'}
          </Link>
          <a
            href={GITHUB_URL}
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-surface px-6 text-[14px] font-medium text-text transition-colors hover:border-border-strong"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

// ── Footer ─────────────────────────────────────────────────────────────────
function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto max-w-[1280px] px-6 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-display text-[15px] font-semibold tracking-tight">
              holo
            </Link>
            <span className="text-[12px] text-text-subtle">
              © {new Date().getFullYear()} · AGPL-3.0
            </span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-text-muted">
            <a href={GITHUB_URL} className="hover:text-text">GitHub</a>
            <a href={DOCS_URL} className="hover:text-text">Docs</a>
            <a href={ROADMAP_URL} className="hover:text-text">Roadmap</a>
            <a href={ARCHITECTURE_URL} className="hover:text-text">Architecture</a>
            <a href={LICENSE_URL} className="hover:text-text">License</a>
          </nav>
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
            All systems normal
          </span>
        </div>
      </div>
    </footer>
  );
}

// ── Pillars band ──────────────────────────────────────────────────────────
const PILLARS = [
  {
    label: 'Context layer',
    title: 'Connect once. Index everything.',
    body: 'Slack, GitHub, Notion, Grain, Pylon, HubSpot — six connectors live, more on the way. Hybrid retrieval (pgvector + tsvector, RRF-fused) over a single ACL-aware index. One ingestion pipeline; every agent reads the same source of truth.',
  },
  {
    label: 'Procedures',
    title: 'Not just search. Callable skills.',
    body: 'Holo learns the procedures your team has already proven out — how a refund is approved, how a security review unfolds — and exposes them as MCP-invokable skills. Agents do not just look things up; they invoke what the company has done before.',
  },
  {
    label: 'Governance',
    title: 'Scoped access. Full observability.',
    body: 'Allowlist-scoped at ingestion: channels, repos, and pages can never reach an agent if they never reached holo. Every call is logged, attributable, and replayable. Per-agent tool allowlists and row-level data scopes round out the personas model — the difference between a useful demo and a tool the company will let into the loop.',
  },
] as const;

function PillarsBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-20">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="caption text-text-subtle">What Holo gives you</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            Three things, one layer.
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {PILLARS.map((p) => (
            <div
              key={p.label}
              className="rounded-lg border border-border bg-surface p-6"
            >
              <p className="caption text-text-subtle">{p.label}</p>
              <h3 className="mt-3 font-display text-[18px] font-semibold leading-snug tracking-tight text-text">
                {p.title}
              </h3>
              <p className="mt-3 text-[14px] leading-6 text-text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Observability band ────────────────────────────────────────────────────
const OBSERVABILITY_ITEMS = [
  {
    title: 'Tool traffic',
    body: 'Which procedures get called, by which agent, how often, p50/p95 latency, error rates. The load-bearing surface, made visible.',
  },
  {
    title: 'Failed queries',
    body: 'What agents tried to ask but got nothing. Every gap is a candidate for the next learned procedure — the feedback loop that makes the layer improve over time.',
  },
  {
    title: 'Audit & replay',
    body: 'Per-call attribution: which agent, which user, which records. Replay any past invocation side-by-side. The artifact your security buyer needs before signing off.',
  },
  {
    title: 'Anomaly signals',
    body: 'Sudden spikes, exfiltration shapes, prompt-injection-shaped tool calls. The dashboard surfaces them before they become incidents.',
  },
] as const;

function ObservabilityBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-20">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="caption text-text-subtle">Observability</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            See what every agent did.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-balance text-[15px] leading-6 text-text-muted">
            You handed agents the keys to your CRM and Slack. The dashboard is how you keep track
            of what they did with them — and how you make the layer better the longer it runs.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 md:grid-cols-4">
          {OBSERVABILITY_ITEMS.map((it) => (
            <div key={it.title} className="rounded-lg border border-border bg-surface p-5">
              <h3 className="font-display text-[15px] font-semibold tracking-tight text-text">
                {it.title}
              </h3>
              <p className="mt-2 text-[13px] leading-5 text-text-muted">{it.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Code card ──────────────────────────────────────────────────────────────
function CodeCard({ title, lang, code }: { title: string; lang: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-[var(--code-bg)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[12px] text-text-subtle">{title}</span>
        <span className="caption text-text-subtle">{lang}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-5 text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
