# Holo

> The shared context layer for your AI agents. An open-source, self-hostable MCP server plus skill layer — every agent points at the same source of truth, so building the next one doesn't mean building yet another retrieval pipeline.

> **Layer today, OS tomorrow.** Today: context layer + procedural skills. Tomorrow: an agent operating system — context, observability, replay, marketplace.

**Status:** Pre-alpha. Building in public. The context layer is wired (5/6 connectors, hybrid RRF search, MCP + REST/OpenAPI, OAuth provider for DCR), the skill layer is on early, observability + audit log + skill marketplace ship today. Not yet ready for production traffic; internal dogfood underway.

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
- **Self-hostable.** `docker compose up` (or `npx holo init` from v0.1) — no Docker socket requirement, no managed-only services on the critical path. AGPL-3.0.
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

Three apps. Sixteen packages. No NestJS in the API tier (gone since [PR #10](#) — `apps/api` removed, REST + MCP folded into `apps/gateway`).

| Layer | Choice |
|---|---|
| Dashboard | **`apps/web`** — Next.js 16 + React 19 App Router. Marketing entry, sign-in, sidebar app shell with `/dashboard`, `/connections`, `/dashboard/team`, `/connect-agent`, `/observability`, `/audit`, `/skills`, `/skills/runs`, `/profile`. All connector OAuth callbacks live here as Next route handlers. The OAuth-provider authorize/register/token endpoints (DCR for MCP clients) live here too. |
| Gateway | **`apps/gateway`** — Hono. MCP JSON-RPC at `POST /mcp` *and* OpenAPI/REST at `/v1/*` (Scalar API reference at `/docs`). One process, two protocols, same backend. Default port `8080`. |
| Worker | **`apps/worker`** — NestJS standalone + BullMQ on Redis. Per-connector ingestion queues (github-prose, github-code, slack, notion, grain, pylon), embedding pipeline (embed → embed-insert → embed-runner), sync scheduler with cursor store, slack-subjects ACL extractor. `step()` checkpoint helper for crash-resumable jobs. |
| ORM | Drizzle 0.45 |
| DB | Postgres 16 + pgvector ≥ 0.8 + pg_trgm |
| Cache/Queue | Redis 7 (`maxmemory-policy=noeviction`) |
| Auth | Better Auth 1.6 — GitHub OAuth + email OTP (Resend); `organization` plugin (multi-tenant); custom OAuth-provider routes for MCP DCR (RFC 7591 + 9728 + 8414). |
| Vector + search | `packages/retrieval-core`: pgvector + tsvector fused with RRF in a single SQL CTE; dual-model embedding fallback (OpenAI + Voyage); ACL-filtered via `acl_subjects && user_subjects`. |
| Embeddings | `text-embedding-3-large` @ 1024 dims (default), `voyage-code-3` for code chunks |
| Skills | `packages/skills` — Anthropic skill format, golden-set + ROUGE-L eval harness, marketplace publish flow with redaction pass. MCP exposes `list_skills`, `get_skill`, `execute_skill`. |
| Connectors | `packages/connectors` — 5 of 6 wired: Slack, GitHub, Notion, Grain, Pylon. **HubSpot pending.** Allowlist enforcement via `connector_allowlists` table (DB-driven, glob or exact-id, per-org). |
| Custom tools | `packages/custom-tools` — CLI-as-tool registration (v0.3); register `bq query`, `psql -c …` etc. as scoped MCP tools without writing a connector. |
| CLI | `packages/cli` — `npx @holo/cli init` scaffolds a self-host install. |
| Monorepo | pnpm workspaces + Turborepo |

Full reasoning, alternatives considered, and migration paths in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Quickstart (self-host)

```bash
# 1. Scaffold a fresh install
mkdir my-holo && cd my-holo
npx @holo/cli init

# 2. Fill the placeholders the wizard printed (.env)
#    HOLO_TOKEN_ENCRYPTION_KEY, BETTER_AUTH_SECRET (auto-generated)
#    GITHUB_LOGIN_CLIENT_ID/SECRET, GITHUB_CONNECTOR_CLIENT_ID/SECRET (you register)
#    Optional: ANTHROPIC_API_KEY, OPENAI_API_KEY, VOYAGE_API_KEY, RESEND_API_KEY

# 3. Bring it up
docker compose up -d

# 4. Open the dashboard
open http://localhost:3000
```

**Requirements:** Docker 24+, Node 20+ (only needed to run `npx`).

Once up:
- **Dashboard** at `http://localhost:3000`
- **MCP / REST gateway** at `http://localhost:8080` — JSON-RPC at `/mcp`, REST at `/v1/*`, API reference at `/docs`
- Sign in via GitHub at `/sign-in`; connect sources at `/connections`; generate an agent token at `/connect-agent`

**Connect your agent:**
```json
{
  "mcpServers": {
    "holo": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <token-from-/connect-agent>" }
    }
  }
}
```

REST equivalent:
```bash
curl -X POST http://localhost:8080/v1/search \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"q": "how do we onboard a new ATS partner?", "topK": 5}'
```

---

## Development (contributors)

> Requires Docker, Node 20+, pnpm 9+.

```bash
git clone https://github.com/maakle/holo.git
cd holo
pnpm install

# Generate secrets + fill in OAuth credentials
cp .env.example .env
echo "HOLO_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
echo "BETTER_AUTH_URL=http://localhost:3000" >> .env
# Register two GitHub OAuth apps (see below) and fill in their IDs/secrets.

# Bring up Postgres + Redis, run migrations
docker compose up -d postgres redis
DATABASE_URL=postgresql://holo:holo@localhost:5436/holo pnpm db:migrate

# Start dev servers
pnpm dev
# apps/web     → http://localhost:3000  (dashboard, marketing, auth)
# apps/gateway → http://localhost:8080  (MCP /mcp, REST /v1/*, API ref /docs)
# apps/worker  → background (BullMQ workers + heartbeat)
```

> **Port note:** Postgres binds to host port `5436` and Redis to `6382` so holo can coexist with other local instances. Override the gateway port via `MCP_PORT`.

### Registering the two GitHub OAuth apps

GitHub Settings → Developer settings → OAuth Apps → New OAuth App. Register **two** apps:

1. **Holo Login** — callback `http://localhost:3000/api/auth/callback/github`, scopes `read:user user:email`. → `GITHUB_LOGIN_CLIENT_ID/SECRET`.
2. **Holo GitHub Connector** — callback `http://localhost:3000/api/connectors/github/callback`, scopes `repo read:org`. → `GITHUB_CONNECTOR_CLIENT_ID/SECRET`.

The split is intentional — login asks for minimal scopes; the connector asks for repo access. See [decision 0001](./docs/decisions/0001-connector-port-interface.md).

---

## Where we are today

The core platform is built. What's shipped vs. pending:

**Shipped on `main`:**
- ✅ Dashboard shell (`apps/web`) with sidebar, theme switcher, design system per `DESIGN.md`
- ✅ Sign-in via GitHub OAuth; multi-tenancy via Better Auth `organization` plugin
- ✅ 5 of 6 connectors with full OAuth + ingestion (Slack, GitHub, Notion, Grain, Pylon)
- ✅ Hybrid RRF search (vector + BM25, single SQL CTE) with dual-model embedding fallback
- ✅ MCP gateway with 7 tools (`search`, `get_pr`, `get_thread`, `get_doc`, `get_call`, `get_ticket`, `list_skills`)
- ✅ REST/OpenAPI surface mirroring the MCP tools, Scalar API reference at `/docs`
- ✅ DB-driven `connector_allowlists` (glob + exact-id, per-org, audit-trailed)
- ✅ MCP DCR — OAuth provider routes (`/api/oauth/{authorize,register,token}`) for agents that self-register
- ✅ `api_token` table + `/connect-agent` page with copy-paste configs (Cursor / Claude Desktop / curl / Python / TypeScript)
- ✅ Observability dashboard (`mcp_invocations` log, last-100 view, latency / error stats)
- ✅ Audit log (`/audit`)
- ✅ Skill eval harness (golden set + ROUGE-L gate) and skill marketplace (`/marketplace`) with redaction-pass publish flow
- ✅ Custom-tool registration (CLI-as-tool, e.g. `bq query`) — `packages/custom-tools` (v0.3)
- ✅ Per-user OAuth ACL fan-out (`packages/user-subjects`) — `acl_subjects && user_subjects` enforced on every search
- ✅ `npx @holo/cli init` self-host scaffold

**Still pending before public launch:**
- ⏳ **Public marketing landing page** — `/` still redirects to `/sign-in`. Needs a real top-of-funnel surface.
- ⏳ **Email OTP form** — backend wired (`emailOTP` plugin + Resend), but `sign-in-form.tsx` only renders the GitHub button. Unblocks non-GitHub users.
- ⏳ **HubSpot connector** — last of the v0.0 six.
- ⏳ **Team invites with email delivery** — `/api/team/invite` is a v0.1 stub (token generated but not persisted, no email sent).
- ⏳ **Cleanup** — empty `apps/mcp/` directory leftover from the rename to `apps/gateway`.

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full plan and [`docs/decisions/0004-multi-agent-shared-context-wedge.md`](./docs/decisions/0004-multi-agent-shared-context-wedge.md) for the wedge framing.

---

## Vision

[`docs/VISION.md`](./docs/VISION.md) explains why this exists in 200 words.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. Good first issues are tagged `good-first-issue`.

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE).

## The name

Holo is named after the Star Wars *holocron* — a small object encrypted with compressed knowledge from many sources, accessed by anyone with the right key. We shortened it to *holo* because nobody wants to type `holocron init` every time.

The metaphor maps directly: a holocron compresses what many people knew into one object that any Jedi could query. Holo compresses what your company's tools collectively know into one MCP endpoint that any agent on your team can call. Same shape, different century.
