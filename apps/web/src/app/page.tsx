import Link from 'next/link';
import { headers } from 'next/headers';
import { getServerAuth } from '@/lib/server-context';
import { HoloLogo } from '@/components/logo';
import { ToolsAgentGraph } from '@/components/tools-agent-graph';

export const dynamic = 'force-dynamic';

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
      <ToolsAgentGraph />
      <PillarsBand />
      <UseCasesBand />
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
    <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-sm supports-backdrop-filter:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
        <Link href="/" aria-label="holo home" className="text-text">
          <HoloLogo />
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
          Built for the sales and support teams already drowning in &ldquo;can our product do
          this?&rdquo; questions. Holo connects your tools once, continuously ingests everything
          your company knows — code, docs, conversations, calls — and exposes it as one
          scope-aware context any agent can call over MCP or OpenAPI. Bring your own — Claude,
          Cursor, ChatGPT, anything — and plug into the loop.
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
      className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-size-[48px_48px] opacity-30 mask-[radial-gradient(ellipse_at_center,black_30%,transparent_70%)]"
      aria-hidden
    />
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
  q: 'does our product support SSO? which customers asked for it?',
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
          <span className="text-accent">company brain</span> — a self-updating context layer
          underneath every agent your team runs, and the procedural extraction layer that
          turns scattered artifacts into invokable skills. The substrate of an AI-native
          company.
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
          If you&apos;re already running multiple agents, holo is the shared, self-updating
          context layer that makes them coherent. The substrate of an AI-native company.
          Star the repo, run it locally, or sign in.
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
    title: 'Connect once. Index everything. Stay fresh.',
    body: 'Slack, GitHub, Notion, Grain, Pylon, HubSpot — six connectors live, more on the way. A continuous sync loop keeps the ACL-aware index current as your company keeps working. Hybrid retrieval (pgvector + tsvector, RRF-fused) over one source of truth every agent reads.',
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

// ── Use cases band ────────────────────────────────────────────────────────
// Order matters: sales enablement and customer support are the wedge. Security
// and the cross-team search box are real, but secondary.
const USE_CASES = [
  {
    label: 'Sales enablement',
    title: 'Answer "can our product do this?" in seconds, not days.',
    body: 'Account executives and solutions engineers paste the question straight into Slack or their agent of choice. Holo answers from the source code itself — the only ground truth that does not rot — alongside Linear tickets, prior calls, and the deal record in Salesforce or HubSpot. Every answer cites where it came from, so reps can forward it to the prospect with confidence.',
    trace: 'search → get_repo → get_ticket → get_deal → draft',
  },
  {
    label: 'Customer support',
    title: 'Drafted replies with the right sources attached.',
    body: 'A Zendesk, Pylon, or Aircall webhook fires on a new ticket or call. Holo pulls the customer’s history, the matching docs page, the closest past resolution, and any open engineering work — and posts a draft reply for the human to approve. Time-to-first-response drops; tone stays consistent; nothing gets answered from a stale doc.',
    trace: 'search → get_ticket → get_doc → get_issue → draft',
  },
  {
    label: 'Security & compliance',
    title: 'Security questionnaires answered with citations.',
    body: 'A founder or security lead pastes a customer questionnaire into a chat agent. Holo pulls prior answers from Notion, the architecture docs, and the actual repo for evidence, then drafts responses with a link back to every source. The week-long scramble before each enterprise deal turns into a one-pass review.',
    trace: 'search → get_doc → get_file → draft',
  },
  {
    label: 'Everyone else',
    title: 'One search box across every system.',
    body: 'A dashboard search box or a Slack /ask command hits the REST surface directly. Ops, design, PM, and revops get ranked results across every connector with deep links back to the source — no agent, no MCP client, no LLM in the path.',
    trace: 'POST /v1/search → ranked chunks',
  },
] as const;

function UseCasesBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-20">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="caption text-text-subtle">What teams build</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            Start with sales and support. Extend from there.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-balance text-[15px] leading-6 text-text-muted">
            Holo is a primitive, not a product. The wedge is the team already paying for the
            problem in lost deals and slow tickets — sales enablement and customer support.
            Once the layer is in, security reviews and a company-wide search box come for
            free. Same backend, same audit trail, different consumers.
          </p>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {USE_CASES.map((u) => (
            <div key={u.label} className="rounded-lg border border-border bg-surface p-6">
              <p className="caption text-text-subtle">{u.label}</p>
              <h3 className="mt-3 font-display text-[18px] font-semibold leading-snug tracking-tight text-text">
                {u.title}
              </h3>
              <p className="mt-3 text-[14px] leading-6 text-text-muted">{u.body}</p>
              <p className="mt-4 font-mono text-[12px] text-text-subtle">{u.trace}</p>
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
    <div className="overflow-hidden rounded-lg border border-border bg-(--code-bg)">
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
