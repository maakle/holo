import Link from 'next/link';
import { headers } from 'next/headers';
import { getServerAuth } from '@/lib/server-context';
import { CONNECTORS } from '@/lib/connector-registry';

const GITHUB_URL = 'https://github.com/maakle/holo';

export default async function Home() {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  const isAuthed = !!session;

  return (
    <div className="min-h-screen">
      <SiteHeader isAuthed={isAuthed} />
      <Hero isAuthed={isAuthed} />
      <ConnectorsStrip />
      <FeatureBYOAgent />
      <FeatureHybridSearch />
      <FeatureSelfHost />
      <FinalCTA isAuthed={isAuthed} />
      <SiteFooter />
    </div>
  );
}

function SiteHeader({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
        <Link href="/" className="font-display text-h3 font-semibold tracking-tight">
          holo
        </Link>
        <nav className="flex items-center gap-6">
          <a
            href={`${GITHUB_URL}#readme`}
            className="text-body-sm text-text-muted hover:text-text"
          >
            Docs
          </a>
          <a href={GITHUB_URL} className="text-body-sm text-text-muted hover:text-text">
            GitHub
          </a>
          {isAuthed ? (
            <Link
              href="/dashboard"
              className="text-body-sm font-medium text-text hover:text-accent"
            >
              Dashboard →
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="text-body-sm font-medium text-text hover:text-accent"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

function Hero({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1280px] gap-16 px-6 py-24 lg:grid-cols-[1.1fr_1fr] lg:gap-12 lg:py-32">
        <div className="max-w-[620px]">
          <p className="text-caption uppercase text-text-subtle">
            Open-source · Apache-2.0 · Self-hostable
          </p>
          <h1 className="mt-4 font-display text-display-1 text-text">
            Shared context for the agents your team is shipping.
          </h1>
          <p className="mt-6 max-w-[560px] text-body text-text-muted">
            One MCP endpoint over Slack, GitHub, Notion, Grain, Pylon, and HubSpot. Every agent
            on your team queries the same source of truth — so building the next one doesn&apos;t
            mean building yet another retrieval pipeline.
          </p>
          <div className="mt-10 flex items-center gap-4">
            <Link
              href={isAuthed ? '/dashboard' : '/sign-in'}
              className="inline-flex h-10 items-center rounded-md bg-accent px-5 text-body-sm font-medium text-accent-fg transition-colors hover:opacity-90"
            >
              {isAuthed ? 'Open dashboard' : 'Get started'}
            </Link>
            <a
              href={GITHUB_URL}
              className="inline-flex h-10 items-center rounded-md border border-border px-5 text-body-sm font-medium text-text transition-colors hover:border-border-strong"
            >
              View on GitHub
            </a>
          </div>
          <p className="mt-6 text-body-sm text-text-subtle">
            Pre-alpha. Building in public — not yet ready for production workloads.
          </p>
        </div>
        <CodeCard
          title="claude_desktop_config.json"
          lang="json"
          code={`{
  "mcpServers": {
    "holo": {
      "url": "https://holo.your-company.com/mcp"
    }
  }
}`}
        />
      </div>
    </section>
  );
}

function ConnectorsStrip() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <p className="text-caption uppercase text-text-subtle">Connectors</p>
        <ul className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-4 font-mono text-mono text-text-muted">
          {CONNECTORS.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span>{c.displayName.toLowerCase()}</span>
              {!c.implemented && (
                <span className="text-text-subtle">· planned</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeatureBYOAgent() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-caption uppercase text-text-subtle">One endpoint, every agent</p>
          <h2 className="mt-4 font-display text-display-2 text-text">
            Bring your own agent. Or several.
          </h2>
          <p className="mt-6 text-body text-text-muted">
            MCP-first for Claude, Cursor, Cline, Continue, Zed, and any custom agent. REST +
            OpenAPI for ChatGPT Actions, Gemini, n8n, Zapier. Same backend, same data, same
            skills — the protocol is the agent&apos;s choice, not yours.
          </p>
        </div>
        <CodeCard
          title="search.ts"
          lang="ts"
          code={`// any MCP-speaking agent
const results = await mcp.callTool('holo', 'search', {
  query: 'how do we onboard a new ATS partner?',
  limit: 5,
});`}
        />
      </div>
    </section>
  );
}

function FeatureHybridSearch() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-24 lg:grid-cols-2 lg:gap-16">
        <CodeCard
          title="retrieval.sql"
          lang="sql"
          code={`-- single CTE: vector + BM25, fused with RRF
WITH vec AS (SELECT id, rank FROM chunks
             ORDER BY embedding <=> $1 LIMIT 50),
     bm25 AS (SELECT id, rank FROM chunks
              WHERE content_tsvector @@ $2 LIMIT 50)
SELECT id FROM rrf_fuse(vec, bm25)
WHERE acl_subjects && $3
LIMIT 10;`}
        />
        <div className="lg:order-first">
          <p className="text-caption uppercase text-text-subtle">Hybrid search</p>
          <h2 className="mt-4 font-display text-display-2 text-text">
            BM25 + vector, fused. ACL-aware by construction.
          </h2>
          <p className="mt-6 text-body text-text-muted">
            pgvector and tsvector fused with reciprocal rank fusion in a single SQL statement.
            Results mirror native source permissions — agents cannot retrieve what their service
            identity cannot see. Cursor-checkpointed incremental sync keeps it fresh without
            full re-pulls.
          </p>
        </div>
      </div>
    </section>
  );
}

function FeatureSelfHost() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto grid max-w-[1024px] gap-12 px-6 py-24 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="text-caption uppercase text-text-subtle">Self-hostable</p>
          <h2 className="mt-4 font-display text-display-2 text-text">
            <code className="font-mono text-display-2">docker compose up</code> and you&apos;re
            running.
          </h2>
          <p className="mt-6 text-body text-text-muted">
            No managed-only services on the critical path. Postgres + pgvector + Redis. Apache
            2.0. Run it in your VPC, behind your VPN, or on a Hetzner box. Managed cloud comes
            later — for teams that want the same code without the ops.
          </p>
        </div>
        <CodeCard
          title="terminal"
          lang="bash"
          code={`$ git clone https://github.com/maakle/holo.git
$ cd holo && pnpm install
$ docker compose up -d postgres redis
$ pnpm db:migrate && pnpm dev
→ http://localhost:3030`}
        />
      </div>
    </section>
  );
}

function FinalCTA({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1024px] px-6 py-24 text-left">
        <p className="text-caption uppercase text-text-subtle">Status: pre-alpha</p>
        <h2 className="mt-4 max-w-[720px] font-display text-display-2 text-text">
          Built for teams running 2+ custom agents in production.
        </h2>
        <p className="mt-6 max-w-[640px] text-body text-text-muted">
          If your team is already paying the per-agent integration tax, holo is the layer that
          makes it stop. Star the repo, run it locally, or sign in to start dogfooding.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <Link
            href={isAuthed ? '/dashboard' : '/sign-in'}
            className="inline-flex h-10 items-center rounded-md bg-accent px-5 text-body-sm font-medium text-accent-fg transition-colors hover:opacity-90"
          >
            {isAuthed ? 'Open dashboard' : 'Get started'}
          </Link>
          <a
            href={GITHUB_URL}
            className="inline-flex h-10 items-center rounded-md border border-border px-5 text-body-sm font-medium text-text transition-colors hover:border-border-strong"
          >
            Star on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8 px-6 py-12 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/" className="font-display text-h3 font-semibold">
            holo
          </Link>
          <p className="mt-2 max-w-[320px] text-body-sm text-text-subtle">
            Open-source, self-hostable MCP context layer. Apache-2.0.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-body-sm sm:flex sm:items-end sm:gap-8">
          <a href={GITHUB_URL} className="text-text-muted hover:text-text">
            GitHub
          </a>
          <a
            href={`${GITHUB_URL}/blob/main/docs/ROADMAP.md`}
            className="text-text-muted hover:text-text"
          >
            Roadmap
          </a>
          <a
            href={`${GITHUB_URL}/blob/main/docs/ARCHITECTURE.md`}
            className="text-text-muted hover:text-text"
          >
            Architecture
          </a>
          <a
            href={`${GITHUB_URL}/blob/main/LICENSE`}
            className="text-text-muted hover:text-text"
          >
            License
          </a>
        </nav>
      </div>
    </footer>
  );
}

function CodeCard({ title, lang, code }: { title: string; lang: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-[var(--code-bg)]">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-mono text-text-subtle">{title}</span>
        <span className="text-caption uppercase text-text-subtle">{lang}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-mono text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
