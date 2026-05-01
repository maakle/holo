# Holo

> The shared context layer for your AI agents. An open-source, self-hostable MCP server plus skill layer — every agent points at the same source of truth, so building the next one doesn't mean building yet another retrieval pipeline.

> **Layer today, OS tomorrow.** Today: context layer + procedural skills. Tomorrow: an agent operating system — context, observability, replay, marketplace.

**Status:** Pre-alpha. Building in public. Not ready for production.

---

## What is this

Engineering teams aren't building one custom AI agent — they're building several. A Slack-triggered Cursor agent that answers product questions from the codebase. A Notion-based agent that prepares interview rubrics from Grain recordings. A customer-success agent over Pylon and HubSpot. Each agent solves a different workflow. Each one re-implements its own context-fetching pipeline against the company's tools.

The cost shows up in the second, third, and fifth agent. Every new one is gated on a new integration. Cross-agent context is impossible because the context layer is a per-agent fork. When a Notion page moves or a Slack channel archives, every agent breaks individually.

Holo is the missing shared layer. It ingests the tools your team's work actually lives in, exposes a small MCP surface any agent can call (`search`, `get_thread`, `get_pr`, `get_doc`, `get_call`, `get_ticket`, `list_recent_activity`, `whats_changed`), and stays current without anyone rebuilding the retrieval code. One ingestion pipeline, many agents.

On top of that context layer, Holo extracts the procedural knowledge that emerges from how the team has actually worked — recurring agent behaviors get distilled into reusable, MCP-invokable skills. The context layer ships first; the skill layer ships in the same release. The combination is what differentiates Holo from open-source unified-search platforms whose agents own the user (Onyx, Dust) and from closed-source enterprise context-graph products (Interloom, Potpie).

## What it does

- **Bring your own agent.** holo is **MCP-first** for Claude (Desktop, claude.ai, API), Cursor, Cline, Continue, Zed, and any MCP-speaking custom agent (LangChain, in-house frameworks). It also exposes **REST + OpenAPI** for ChatGPT Actions, Gemini function calling, n8n, Zapier, and anything that speaks HTTP. Same backend, same data, same skills — the protocol is the agent's choice, not yours.
- **One endpoint, two consumer layers.** *Custom agents your team built* — Cursor in Slack, Claude Code, LangChain, in-house Python, Notion-based — point at holo for production traffic. *Off-the-shelf clients* — Claude Desktop, Cursor's MCP integration, Cline, ChatGPT, Gemini — connect for ad-hoc queries. Both layers, both protocols, one auth.
- **Connectors for the tools your work actually lives in.** Slack, GitHub, Notion, Grain, Pylon, HubSpot at v0.1. More follow as users ask.
- **Hybrid search built for agents.** Vector + BM25 fused with Reciprocal Rank Fusion, ACL-aware results that mirror native source permissions. Agents cannot retrieve what their service identity cannot see.
- **Continuous, durable sync.** Cursor-checkpointed incremental pulls per connector from day 1 (no full re-pulls — Slack and GitHub rate limits make those unworkable). Webhook-accelerated when a real freshness pain demands it. Crash-resumable. Source-of-truth stays the originating tool.
- **Procedural skill synthesis.** Recurring agent behaviors get distilled into invokable skills served via `list_skills` / `get_skill` over MCP and over REST. Labeled-template extraction in v0.1; free-form unsupervised in v0.2 once the eval harness exists.
- **Self-hostable.** `docker compose up` (or `npx holo init` from v0.1) — no Docker socket requirement, no managed-only services on the critical path. Apache-2.0.
- **Managed cloud, eventually.** Self-hostable is the wedge. Managed cloud is the path to a sustainable company — same code, run by us. See [`docs/PRICING.md`](./docs/PRICING.md) for the pricing-direction placeholder. Real numbers arrive after v0.1 has paying-signal conversations.

## Who it's for

CTOs and lead engineers at small/mid-stage tech companies (30–80 person) who are *currently maintaining 2+ custom AI agents in production*, with each agent's context-fetching code copy-pasted from the last one. Buyer = builder = sufferer collapsed into one role. If you don't have agents in production yet, you're early — Holo compounds value with each new agent, not the first.

## Why now

Two YC RFSs (2026) describe adjacent pieces of what Holo is:

- **["The AI Operating System for Companies"](https://www.ycombinator.com/rfs#ai-operating-system-for-companies)** by Diana Hu — the queryable context layer underneath agent operations.
- **["Company Brain"](https://www.ycombinator.com/rfs#company-brain)** by Tom Blomfield — the procedural extraction layer that turns scattered artifacts into invokable skills.

Holo is the open-source, self-hostable take that doesn't require building the agent in our framework. Bring your own.

---

## Architecture (the short version)

| Layer | Choice |
|---|---|
| Web/API | NestJS 11 (API) + Next.js 15 App Router (dashboard) |
| ORM | Drizzle on Postgres + pgvector ≥ 0.8 |
| Auth | Better Auth — single-user mode in v0.0, `organization` plugin in v0.1, `oauthProvider` for MCP DCR in v0.2 |
| Workers | BullMQ on Redis, NestJS-wrapped, with a `step()` checkpoint helper |
| Connectors | Hand-written behind a `Connector<>` interface, official SDKs |
| Vector + search | pgvector + tsvector + pg_trgm fused with RRF; opt-in `pg_search` (ParadeDB) |
| Embeddings | `text-embedding-3-large` truncated to 1024 dims (cloud) / BGE-M3 (self-host) |
| MCP | Sibling Hono service sharing a `retrieval-core` package with the API |
| Skills | Synthesizer worker that turns artifacts into `SKILL.md` files; MCP exposes `list_skills`, `get_skill`, `execute_skill` |
| Monorepo | pnpm workspaces + Turborepo |

Full reasoning, alternatives considered, and migration paths in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Read it before opening a "why not X" issue.

---

## Quickstart

Self-host holo in under 5 minutes:

```bash
# 1. Create a directory and run the setup wizard
mkdir my-holo && cd my-holo
npx @holo/cli init

# 2. Fill in the placeholders the wizard printed
#    ANTHROPIC_API_KEY, GITHUB_LOGIN_CLIENT_ID, GITHUB_LOGIN_CLIENT_SECRET

# 3. Bring it up
curl -fsSL https://raw.githubusercontent.com/<owner>/holo/main/docker-compose.yml -o docker-compose.yml
docker compose up -d

# 4. Open the dashboard
open http://localhost:3030
```

**Requirements:** Docker 24+, Node.js 20+ (only needed to run `npx`)

**Connect your agent (Cursor):**
```json
{
  "mcpServers": {
    "holo": {
      "url": "http://localhost:8091/mcp",
      "headers": { "Authorization": "Bearer <your-token-from-dashboard>" }
    }
  }
}
```
Get your token at `http://localhost:3030/connect-agent`.

---

## Quick start (v0.0 Foundation — development)

> Requires Docker, Node 20+, pnpm 9+. v0.0 Foundation is the deployable skeleton: login + GitHub Connector OAuth roundtrip, no ingestion or retrieval yet. See [`docs/superpowers/specs/2026-04-29-v0.0-foundation-design.md`](./docs/superpowers/specs/2026-04-29-v0.0-foundation-design.md).

```bash
git clone https://github.com/your-org/holo.git
cd holo
pnpm install

# Set up env
cp .env.example .env
# Generate the two secrets:
echo "HOLO_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_URL=http://localhost:3030" >> .env
# Then fill in GITHUB_LOGIN_CLIENT_ID/SECRET and GITHUB_CONNECTOR_CLIENT_ID/SECRET
# from the two GitHub OAuth apps you registered (see below).

# Bring up Postgres + Redis, run migrations
docker compose up -d postgres redis
DATABASE_URL=postgresql://holo:holo@localhost:5436/holo pnpm db:migrate

# Start dev servers
pnpm dev
# apps/web    → http://localhost:3030
# apps/api    → http://localhost:4000
# apps/mcp    → http://localhost:8091
# apps/worker → background, logs heartbeat every 60s
```

> **Port note:** Postgres binds to host port `5436` and Redis to `6382` so holo can coexist with other local Postgres/Redis instances. apps/web runs on `3030`, apps/mcp on `8091`. Override via `MCP_PORT` and Next.js `-p` flag if needed.

Visit `http://localhost:3030`. Sign in via GitHub. Click "Connect" on the GitHub row in `/connections` to complete the connector OAuth roundtrip — the row flips to "Connected ✓" and your encrypted token is stored in `connector_credentials`.

The MCP server is at `http://localhost:8091/health` (no MCP tools registered yet — those land in spec #2). To connect Claude Desktop later:

```json
{
  "mcpServers": {
    "holo": { "url": "http://localhost:8091/mcp" }
  }
}
```

### Registering the two GitHub OAuth apps

GitHub Settings → Developer settings → OAuth Apps → New OAuth App. Register **two** apps:

1. **Holo Login** — Authorization callback URL `http://localhost:3030/api/auth/callback/github`, scopes `read:user user:email`. Used as `GITHUB_LOGIN_CLIENT_ID/SECRET`.
2. **Holo GitHub Connector** — Authorization callback URL `http://localhost:3030/api/connectors/github/callback`, scopes `repo read:org`. Used as `GITHUB_CONNECTOR_CLIENT_ID/SECRET`.

The two-app split is intentional — login asks for minimal scopes; the connector asks for repo access. See [decision 0001](./docs/decisions/0001-connector-port-interface.md) and the Foundation spec for rationale.

## Quick start (self-host)

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Or one-click on Railway: *(coming once v0.1 ships)*

---

## Roadmap

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full plan and [`docs/decisions/0004-multi-agent-shared-context-wedge.md`](./docs/decisions/0004-multi-agent-shared-context-wedge.md) for why this changed from earlier docs.

- **v0.0 — Internal context layer** *(weeks 0–6)* — 6 connectors (Slack, GitHub, Notion, Grain, Pylon, HubSpot), MCP server with 6 tools, hybrid RRF search, ingestion-time allowlists, dogfooded against the founder's own existing custom agents. Not public yet.
- **v0.1 — Skills + public release + OS surface** *(weeks 7–17, ~10–11 weeks)* — labeled-template skill synthesis with eval harness; **skill marketplace stub** (publish anonymized skills to a public registry); **agent observability dashboard with read-only replay diff** (the OS-tomorrow surface, made concrete); **`npx holo init` single-line install** (macOS + Linux); REST + OpenAPI surface for ChatGPT Actions / Gemini; week-10 skill quality kill-switch; public Apache-2.0 release on GitHub Releases / GHCR.
- **v0.2 — Self-host polish + free-form skills + managed cloud** *(weeks 18+)* — Railway / Coolify one-click templates, per-user OAuth ACL fan-out, free-form unsupervised skill extraction, replay live-execution (gated on tool-effect classification), Windows support for `npx holo init`, managed cloud beta, audit log.
- **Beyond** — drift detection (intent-vs-reality), more connectors, agent templates marketplace, inferred org chart. No fixed dates.

See [`docs/designs/holo-v01-yc-prep.md`](./docs/designs/holo-v01-yc-prep.md) for the full v0.1 expansion plan.

---

## Vision

[`docs/VISION.md`](./docs/VISION.md) explains why this exists in 200 words.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. Good first issues are tagged `good-first-issue`.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

## The name

Holo is named after the Star Wars *holocron* — a small object encrypted with compressed knowledge from many sources, accessed by anyone with the right key. We shortened it to *holo* because nobody wants to type `holocron init` every time.

The metaphor maps directly: a holocron compresses what many people knew into one object that any Jedi could query. Holo compresses what your company's tools collectively know into one MCP endpoint that any agent on your team can call. Same shape, different century.
