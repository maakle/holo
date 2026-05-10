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
const GITHUB_API_REPO_URL = 'https://api.github.com/repos/maakle/holo';

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
      <div className="relative mx-auto max-w-[1024px] px-6 pt-16 pb-20 text-center md:pt-24">
        <div className="flex flex-col items-center gap-2">
          {/* Async server component: fetches GitHub star count with 1h cache. */}
          <StarButton />
          <p className="caption text-text-subtle">Open source · Self-hostable</p>
        </div>
        <h1 className="mx-auto mt-8 max-w-[920px] text-balance font-display text-[44px] font-semibold leading-[1.05] tracking-tight md:text-[60px]">
          The agent context layer
          <br />
          for your company.
        </h1>
        <p className="mx-auto mt-6 max-w-[560px] text-balance text-[15px] leading-6 text-text-muted">
          Connect your tools once. Holo ingests everything your company knows and serves it
          to every agent over MCP or OpenAPI.
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
            View on GitHub
          </a>
        </div>
        <p className="mt-6 text-[12px] text-text-subtle">
          Pre-alpha — not yet ready for production traffic.
        </p>
      </div>
    </section>
  );
}

/**
 * GitHub star button with live count. Server-rendered with a 1-hour fetch
 * cache so we don't hammer GitHub's unauthenticated API (60 req/h limit) on
 * every page render — even though the route is `force-dynamic`, Next caches
 * the underlying fetch by URL + revalidate. Falls back gracefully to a
 * count-less "Star" button if the API is unreachable.
 */
async function StarButton() {
  let countLabel: string | null = null;
  try {
    const res = await fetch(GITHUB_API_REPO_URL, {
      next: { revalidate: 3600 },
      headers: {
        // GitHub requires User-Agent on every API request.
        'User-Agent': 'holo-landing',
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.ok) {
      const json = (await res.json()) as { stargazers_count?: number };
      const n = json.stargazers_count;
      if (typeof n === 'number') countLabel = formatStarCount(n);
    }
  } catch {
    // Network error or rate-limited — render the button without a count.
  }
  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Star holo on GitHub"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-text shadow-xs transition-colors hover:border-border-strong"
    >
      <GitHubMark className="h-4 w-4" aria-hidden />
      <span>Star</span>
      {countLabel ? (
        <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-[12px] font-medium text-text-muted tabular-nums">
          {countLabel}
        </span>
      ) : null}
    </a>
  );
}

function formatStarCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  // 7,300 → "7.3k", 12,500 → "12.5k", 1,000 → "1k", 10,000 → "10k"
  const fixed = k >= 10 ? k.toFixed(0) : k.toFixed(1);
  return fixed.replace(/\.0$/, '') + 'k';
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
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
            MCP for Claude, Cursor, Cline. REST + OpenAPI for ChatGPT, Gemini, n8n. Same
            backend — the protocol is the agent&apos;s choice.
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
          underneath every agent. The substrate of an AI-native company.
        </p>
        <p className="mx-auto mt-4 max-w-[560px] text-[12px] text-text-subtle">
          Two adjacent YC Requests for Startups. Holo is the open-source take.
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
        <p className="mx-auto mt-5 max-w-[520px] text-balance text-[15px] leading-6 text-text-muted">
          The shared context layer that makes your agents coherent. Star the repo, run it
          locally, or sign in.
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
    body: '13+ connectors, continuous ACL-aware sync. Hybrid retrieval (vector + full-text) over one source of truth every agent reads.',
  },
  {
    label: 'Procedures',
    title: 'Not just search. Callable skills.',
    body: 'Holo learns the procedures your team has proven out and exposes them as MCP-invokable skills. Agents invoke what the company has done before.',
  },
  {
    label: 'Governance',
    title: 'Scoped access. Full observability.',
    body: 'Allowlist-scoped at ingestion. Every call logged, attributable, replayable. Per-agent tool allowlists and row-level data scopes.',
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
    title: 'Answer "can our product do this?" in seconds.',
    body: 'AEs and SEs paste the question into Slack or their agent. Holo answers from source code, Linear, prior calls, and the deal record — every answer cited.',
    trace: 'search → get_repo → get_ticket → get_deal → draft',
  },
  {
    label: 'Customer support',
    title: 'Drafted replies with the right sources attached.',
    body: 'A new ticket fires a webhook. Holo pulls the customer’s history, matching docs, and prior resolutions — and posts a draft reply for the human to approve.',
    trace: 'search → get_ticket → get_doc → get_issue → draft',
  },
  {
    label: 'Security & compliance',
    title: 'Security questionnaires answered with citations.',
    body: 'Paste the questionnaire into chat. Holo pulls prior answers, architecture docs, and source code as evidence — drafts answers with links to every source.',
    trace: 'search → get_doc → get_file → draft',
  },
  {
    label: 'Everyone else',
    title: 'One search box across every system.',
    body: 'A dashboard search box or a Slack /ask command hits REST directly. Ranked results across every connector — no agent, no MCP, no LLM in the path.',
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
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[15px] leading-6 text-text-muted">
            Sales enablement and customer support are the wedge. Once the layer is in,
            security reviews and a company-wide search box come for free.
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
    body: 'Which procedures get called, by which agent, p50/p95 latency, error rates.',
  },
  {
    title: 'Failed queries',
    body: 'What agents tried to ask but got nothing. Every gap is a candidate for the next learned procedure.',
  },
  {
    title: 'Audit & replay',
    body: 'Per-call attribution: which agent, which user, which records. Replay any past invocation side-by-side.',
  },
  {
    title: 'Anomaly signals',
    body: 'Spikes, exfiltration shapes, prompt-injection-shaped tool calls — surfaced before they become incidents.',
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
          <p className="mx-auto mt-4 max-w-[560px] text-balance text-[15px] leading-6 text-text-muted">
            You handed agents the keys to your CRM and Slack. The dashboard shows what they
            did with them.
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
