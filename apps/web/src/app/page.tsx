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
      <CodeShowcase />
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
          Shared agent context.
          <br />
          The OS underneath.
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-balance text-[15px] leading-6 text-text-muted">
          One context layer over the tools your team&apos;s work lives in. Every agent you
          ship — support, interview-prep, customer-success — queries the same source of truth.
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
          <p className="caption text-text-subtle">One context layer · many agents</p>
          <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
            Every agent. Same context. Same skills.
          </h2>
          <p className="mt-4 text-balance text-[15px] leading-6 text-text-muted">
            MCP for Claude, Cursor, Cline. REST + OpenAPI for ChatGPT Actions, Gemini, n8n.
            Same backend, same data, same procedural skills — the protocol is the agent&apos;s
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
