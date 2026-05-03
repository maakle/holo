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
      <FeatureBYOAgent />
      <FeatureHybridSearch />
      <FeatureSelfHost />
      <StatsBand />
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
      <div className="relative mx-auto max-w-[1024px] px-6 pt-20 pb-16 text-center md:pt-28 md:pb-24">
        <p className="caption text-text-subtle">
          Open-source · Apache-2.0 · Self-hostable
        </p>
        <h1 className="mt-6 mx-auto max-w-[820px] font-display text-[44px] font-semibold tracking-tight md:text-[56px] md:leading-[1.05]">
          Shared context for the agents your team is shipping.
        </h1>
        <p className="mx-auto mt-6 max-w-[640px] text-[15px] leading-6 text-text-muted">
          One MCP endpoint over Slack, GitHub, Notion, Grain, and Pylon. Every agent on your
          team queries the same source of truth — so building the next one doesn&apos;t mean
          building yet another retrieval pipeline.
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
          Pre-alpha. Building in public — not yet ready for production traffic.
        </p>

        <div className="mx-auto mt-14 max-w-[720px] text-left">
          <CodeCard
            title="claude_desktop_config.json"
            lang="json"
            code={`{
  "mcpServers": {
    "holo": {
      "url": "https://holo.your-company.com/mcp",
      "headers": {
        "Authorization": "Bearer holo_xxxxxxxxxxxx"
      }
    }
  }
}`}
          />
        </div>
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
  { id: 'slack', label: 'Slack', live: true },
  { id: 'github', label: 'GitHub', live: true },
  { id: 'notion', label: 'Notion', live: true },
  { id: 'grain', label: 'Grain', live: true },
  { id: 'pylon', label: 'Pylon', live: true },
  { id: 'hubspot', label: 'HubSpot', live: false },
] as const;

function ConnectorsStrip() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <p className="caption text-text-subtle">Connectors</p>
        <ul className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-3 font-mono text-[13px]">
          {CONNECTOR_ITEMS.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className={c.live ? 'text-text' : 'text-text-subtle'}>{c.label.toLowerCase()}</span>
              {c.live ? (
                <span className="text-[10px] uppercase tracking-[0.06em] text-text-subtle">
                  live
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-[0.06em] text-text-subtle">
                  planned
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── Feature: BYO agent ─────────────────────────────────────────────────────
function FeatureBYOAgent() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-20 md:grid-cols-2 md:gap-16">
        <div>
          <p className="caption text-text-subtle">One endpoint, every agent</p>
          <h2 className="mt-3 font-display text-[32px] font-semibold tracking-tight md:text-[36px]">
            Bring your own agent.
            <br />
            Or several.
          </h2>
          <p className="mt-5 text-[15px] leading-6 text-text-muted">
            MCP-first for Claude Desktop, Cursor, Cline, and any custom agent that speaks
            JSON-RPC. REST + OpenAPI for ChatGPT Actions, Gemini, and anything that speaks
            HTTP. Same backend, same data, same skills — the protocol is the agent&apos;s
            choice, not yours.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-text-muted">
            <li>· Bearer-token auth, hashed at rest</li>
            <li>· Per-org tokens, copy-paste config snippets</li>
            <li>· Scalar API reference at <span className="font-mono">/docs</span></li>
          </ul>
        </div>
        <CodeCard
          title="search.ts"
          lang="ts"
          code={`// any MCP-speaking agent
const { content } = await mcp.callTool('holo', 'search', {
  q: 'how do we onboard a new ATS partner?',
  topK: 5,
});

// or via REST
const r = await fetch('https://holo/v1/search', {
  method: 'POST',
  headers: { Authorization: \`Bearer \${HOLO_TOKEN}\` },
  body: JSON.stringify({ q, topK: 5 }),
});`}
        />
      </div>
    </section>
  );
}

// ── Feature: Hybrid search ────────────────────────────────────────────────
function FeatureHybridSearch() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-20 md:grid-cols-2 md:gap-16">
        <CodeCard
          title="retrieval.sql"
          lang="sql"
          code={`-- single CTE: vector + BM25, fused with RRF
WITH vec AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY embedding <=> $query_vec
  ) AS rank
  FROM chunks
  WHERE org_id = $org
    AND acl_subjects && $user_subjects
  LIMIT 100
), bm25 AS (
  SELECT id, ROW_NUMBER() OVER (
    ORDER BY ts_rank(content_tsvector, $q) DESC
  ) AS rank
  FROM chunks
  WHERE content_tsvector @@ $q
    AND acl_subjects && $user_subjects
  LIMIT 100
)
SELECT id, SUM(1.0 / (60 + rank)) AS score
FROM (SELECT * FROM vec UNION ALL SELECT * FROM bm25) t
GROUP BY id ORDER BY score DESC LIMIT 10;`}
        />
        <div className="md:order-first">
          <p className="caption text-text-subtle">Hybrid search</p>
          <h2 className="mt-3 font-display text-[32px] font-semibold tracking-tight md:text-[36px]">
            BM25 + vector. Fused.
          </h2>
          <p className="mt-5 text-[15px] leading-6 text-text-muted">
            pgvector and tsvector, fused with reciprocal rank fusion in a single SQL CTE.
            Dual-model embedding fallback (OpenAI + Voyage) so a code query and a prose
            query route correctly. Results filtered by{' '}
            <span className="font-mono">acl_subjects</span> — agents cannot retrieve what
            their service identity cannot see.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-text-muted">
            <li>· Cursor-checkpointed incremental sync per connector</li>
            <li>· Per-org allowlist (glob or exact-id, audit-trailed)</li>
            <li>· Per-user OAuth ACL fan-out</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── Feature: Self-host ────────────────────────────────────────────────────
function FeatureSelfHost() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-20 md:grid-cols-2 md:gap-16">
        <div>
          <p className="caption text-text-subtle">Self-hostable</p>
          <h2 className="mt-3 font-display text-[32px] font-semibold tracking-tight md:text-[36px]">
            <span className="font-mono text-[28px] md:text-[32px]">docker compose up</span>{' '}
            and you&apos;re running.
          </h2>
          <p className="mt-5 text-[15px] leading-6 text-text-muted">
            Postgres + pgvector + Redis. No managed-only services on the critical path. Apache
            2.0. Run it in your VPC, behind your VPN, or on a Hetzner box. Managed cloud comes
            later — same code, run by us.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-text-muted">
            <li>· Three apps: web (Next 16), gateway (Hono), worker (BullMQ)</li>
            <li>· Drizzle-managed schema; migrations in CI</li>
            <li>· OAuth DCR for MCP clients (RFC 7591/9728/8414)</li>
          </ul>
        </div>
        <CodeCard
          title="terminal"
          lang="bash"
          code={`$ npx @holo/cli init
✓ Wrote docker-compose.yml + .env
✓ Generated HOLO_TOKEN_ENCRYPTION_KEY + BETTER_AUTH_SECRET
→ Fill in GITHUB_LOGIN_CLIENT_ID/SECRET, then:

$ docker compose up -d
✓ postgres + redis up
✓ migrate (one-shot) → chunks, sources, …
✓ web :3000  gateway :8080  worker (bg)

→ http://localhost:3000`}
        />
      </div>
    </section>
  );
}

// ── Stats band ─────────────────────────────────────────────────────────────
function StatsBand() {
  const stats = [
    { value: '5', label: 'connectors live', sub: '+ HubSpot pending' },
    { value: '7', label: 'MCP tools', sub: 'search · get_pr · …' },
    { value: 'DCR', label: 'OAuth provider', sub: 'RFC 7591 / 9728 / 8414' },
    { value: 'Apache 2.0', label: 'license', sub: 'self-host or managed' },
  ];
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-16">
        <p className="caption text-text-subtle">What&apos;s wired today</p>
        <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-bg p-6">
              <dt className="font-display text-[28px] font-semibold tracking-tight">
                {s.value}
              </dt>
              <dd className="mt-1 text-[13px] text-text">{s.label}</dd>
              <dd className="mt-1 text-[12px] text-text-subtle">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ── Final CTA ─────────────────────────────────────────────────────────────
function FinalCTA({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1024px] px-6 py-24 text-center">
        <p className="caption text-text-subtle">Status · pre-alpha</p>
        <h2 className="mx-auto mt-4 max-w-[760px] font-display text-[36px] font-semibold tracking-tight md:text-[44px]">
          Built for teams running 2+ custom agents in production.
        </h2>
        <p className="mx-auto mt-6 max-w-[600px] text-[15px] leading-6 text-text-muted">
          If your team is already paying the per-agent integration tax — Slack-triggered
          Cursor here, Notion-based interview-prep there — holo is the layer that makes it
          stop. Star the repo, run it locally, or sign in to start dogfooding.
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
  const groups: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
    {
      heading: 'Build',
      links: [
        { label: 'GitHub', href: GITHUB_URL },
        { label: 'Roadmap', href: ROADMAP_URL },
        { label: 'Architecture', href: ARCHITECTURE_URL },
      ],
    },
    {
      heading: 'Docs',
      links: [
        { label: 'Quickstart', href: `${GITHUB_URL}#quickstart-self-host` },
        { label: 'Connect agent', href: '/connect-agent' },
        { label: 'API reference', href: 'http://localhost:8080/docs' },
      ],
    },
    {
      heading: 'Resources',
      links: [
        { label: 'Vision', href: `${GITHUB_URL}/blob/main/docs/VISION.md` },
        { label: 'Pricing', href: `${GITHUB_URL}/blob/main/docs/PRICING.md` },
        { label: 'License', href: LICENSE_URL },
      ],
    },
    {
      heading: 'Community',
      links: [
        { label: 'Issues', href: `${GITHUB_URL}/issues` },
        { label: 'Discussions', href: `${GITHUB_URL}/discussions` },
        { label: 'Releases', href: `${GITHUB_URL}/releases` },
      ],
    },
  ];

  return (
    <footer>
      <div className="mx-auto max-w-[1280px] px-6 py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href="/" className="font-display text-[18px] font-semibold tracking-tight">
              holo
            </Link>
            <p className="mt-3 max-w-[320px] text-[13px] text-text-muted">
              Open-source, self-hostable MCP context layer. Serious infrastructure for serious
              AI work.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
              All systems normal
            </div>
          </div>
          <nav className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {groups.map((g) => (
              <div key={g.heading} className="space-y-3">
                <p className="caption text-text-subtle">{g.heading}</p>
                <ul className="space-y-2 text-[13px]">
                  {g.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} className="text-text-muted hover:text-text">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-[12px] text-text-subtle sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} holo · Apache-2.0</span>
          <span>
            Made by teams shipping more than one agent.{' '}
            <a href={GITHUB_URL} className="hover:text-text">
              Contribute →
            </a>
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
