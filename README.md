# Memex

> The shared context layer for the multiple custom agents your team already ships. An open-source, self-hostable substrate plus skill layer that any agent can point at over MCP — so the next agent doesn't require building yet another retrieval pipeline.

**Status:** Pre-alpha. Building in public. Not ready for production.

---

## What is this

Engineering teams aren't building one custom AI agent — they're building several. A Slack-triggered Cursor agent that answers product questions from the codebase. A Notion-based agent that prepares interview rubrics from Grain recordings. A customer-success agent over Pylon and HubSpot. Each agent solves a different workflow. Each one re-implements its own context-fetching pipeline against the company's tools.

The cost shows up in the second, third, and fifth agent. Every new one is gated on a new integration. Cross-agent context is impossible because the substrate is a per-agent fork. When a Notion page moves or a Slack channel archives, every agent breaks individually.

Memex is the missing shared layer. It ingests the tools your team's work actually lives in, exposes a small MCP surface any agent can call (`search`, `get_thread`, `get_pr`, `get_doc`, `get_call`, `get_ticket`, `list_recent_activity`, `whats_changed`), and stays current without anyone rebuilding the retrieval code. One ingestion pipeline, many agents.

On top of that substrate, Memex extracts the procedural knowledge that emerges from how the team has actually worked — recurring agent behaviors get distilled into reusable, MCP-invokable skills. The substrate ships first; the skill layer ships in the same release. The combination is what differentiates Memex from open-source unified-search platforms whose agents own the user (Onyx, Dust) and from closed-source enterprise context-graph products (Interloom, Potpie).

## What it does

- **Shared MCP context surface for any agent your team builds.** Cursor, Claude Code, LangChain, in-house frameworks — all point at one MCP endpoint instead of writing bespoke retrievers. New agents stop carrying connector setup tax.
- **Connectors for the tools your work actually lives in.** Slack, GitHub, Notion, Grain, Pylon, HubSpot at v0.1. More follow as users ask.
- **Hybrid search built for agents.** Vector + BM25 fused with Reciprocal Rank Fusion, ACL-aware results that mirror native source permissions. Agents cannot retrieve what their service identity cannot see.
- **Continuous, durable sync.** Cadence-driven full pulls in v0.0; webhook-accelerated incremental sync once a real freshness pain demands it. Crash-resumable. Source-of-truth stays the originating tool.
- **Procedural skill synthesis.** Recurring agent behaviors get distilled into MCP-invokable skills (`list_skills`, `get_skill`). Labeled-template extraction in v0.1; free-form unsupervised in v0.2 once the eval harness exists.
- **MCP-first.** Agents connect via OAuth 2.1; static-token auth in v0.0. REST API secondary.
- **Self-hostable.** `docker compose up`. No Docker socket requirement, no managed-only services on the critical path.
- **Open source, Apache-2.0.**

## Who it's for

CTOs and lead engineers at small/mid-stage tech companies (30–80 person) who are *currently maintaining 2+ custom AI agents in production*, with each agent's context-fetching code copy-pasted from the last one. Buyer = builder = sufferer collapsed into one role. If you don't have agents in production yet, you're early — Memex compounds value with each new agent, not the first.

## Why now

Two YC RFSs (2026) describe adjacent pieces of what Memex is:

- **["The AI Operating System for Companies"](https://www.ycombinator.com/rfs#ai-operating-system-for-companies)** by Diana Hu — the queryable substrate underneath agent operations.
- **["Company Brain"](https://www.ycombinator.com/rfs#company-brain)** by Tom Blomfield — the procedural extraction layer that turns scattered artifacts into invokable skills.

Memex is the open-source, self-hostable take that doesn't require building the agent in our framework. Bring your own.

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

## Quick start (development)

> Requires Docker, Node 20+, pnpm 9+.

```bash
git clone https://github.com/your-org/memex.git
cd memex
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`. The MCP server is at `http://localhost:8090/mcp`.

To connect Claude Desktop, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memex": { "url": "http://localhost:8090/mcp" }
  }
}
```

## Quick start (self-host)

```bash
docker compose -f deploy/docker-compose.yml up -d
```

Or one-click on Railway: *(coming once v0.1 ships)*

---

## Roadmap

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full plan and [`docs/decisions/0004-multi-agent-shared-context-wedge.md`](./docs/decisions/0004-multi-agent-shared-context-wedge.md) for why this changed from earlier docs.

- **v0.0 — Internal substrate** *(weeks 0–6)* — 6 connectors (Slack, GitHub, Notion, Grain, Pylon, HubSpot), MCP server with 8 tools, hybrid RRF search, single-service-identity ACL, dogfooded against the founder's own existing custom agents. Not public yet.
- **v0.1 — Skills + public release** *(weeks 7–14)* — labeled-template skill synthesis, `list_skills` / `get_skill` MCP tools, eval harness, week-10 quality kill-switch, public Apache-2.0 release on GitHub Releases / GHCR.
- **v0.2 — Self-host polish + free-form skills** *(weeks 15+)* — Railway / Coolify one-click templates, per-user OAuth ACL fan-out, free-form unsupervised skill extraction, audit log.
- **Beyond** — drift detection (intent-vs-reality), more connectors, managed cloud offering. No fixed dates.

---

## Vision

[`docs/VISION.md`](./docs/VISION.md) explains why this exists in 200 words.

## Contributing

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR. Good first issues are tagged `good-first-issue`.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).

## The name

From Vannevar Bush, *As We May Think* (Atlantic Monthly, July 1945):

> "Consider a future device for individual use, which is a sort of mechanized private file and library. It needs a name, and to coin one at random, 'memex' will do. A memex is a device in which an individual stores all his books, records, and communications, and which is mechanized so that it may be consulted with exceeding speed and flexibility. It is an enlarged intimate supplement to his memory."
