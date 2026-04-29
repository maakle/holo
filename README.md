# Memex

> The connective tissue between every tool your company uses and the agents that act on its behalf. An open-source operating system that ingests company knowledge, synthesizes it into executable skills, and exposes both to AI through MCP.

**Status:** Pre-alpha. Building in public. Not ready for production.

---

## What is this

In 1945, Vannevar Bush wrote an essay called *As We May Think*. He described a device he called the "memex" — a personal store of every book, record, and communication a person had ever produced, mechanized so it could be consulted with extraordinary speed. An enlarged, intimate supplement to memory.

Eighty years later, every company already has its memex — scattered across Slack, Linear, GitHub, Notion, Google Workspace, call recordings, support tickets, customer emails. The information exists. It's just not consultable. The company works because humans vaguely remember where the knowledge lives and how to apply it. Agents can't operate like that.

Memex is the missing layer. It pulls knowledge from every tool, structures it, keeps it current, and makes it queryable by humans and agents alike. Then it goes further: it watches the knowledge, extracts the *procedures* hidden inside it (how refunds get handled, how PRs get reviewed, how incidents get triaged), and exposes them as executable skills agents can invoke.

The thesis: querying isn't enough. Agents need to know *what to do*, not just *what's been said*. Memex is the substrate plus the skill layer that turns it into action.

## What it does

- **Universal company graph.** Bidirectional connectors to Slack, Linear, GitHub, Notion, Google Workspace, and meeting/transcript platforms (Granola, Fathom, Fireflies). Everything normalizes into one store with provenance and ACL preservation.
- **Continuous, durable sync.** Runs on cadence multiple times per day, accelerated by webhooks. Crash-resumable. Source-of-truth is the periodic pull.
- **Hybrid search built for agents.** Vector + BM25 fused with Reciprocal Rank Fusion, optional reranking, ACL-aware results that mirror native source permissions. Agents cannot retrieve what users cannot see.
- **Procedural skill synthesis.** Memex watches the substrate and extracts how things get done — emitting skills as `SKILL.md` files agents can discover and invoke. Skills stay current as the underlying procedures evolve.
- **MCP-first interface.** Agents connect via OAuth 2.1 + Dynamic Client Registration. Eight retrieval tools plus a skill execution surface. REST API is secondary.
- **Closed-loop drift detection.** Declare what *should* be happening (sprint goals, OKRs, PRDs) and Memex continuously compares actual artifacts against stated intent. The system that flags when engineering is building the wrong thing.
- **Self-hostable.** `docker compose up` works. Five long-lived containers, no Vercel lock-in, no Docker socket requirement, no managed-only services on the critical path.
- **Open source, Apache-2.0.**

## Who it's for

Technical founders, CTOs, and platform teams who want their company's knowledge — and the procedures hidden inside it — accessible to internal agents without sending the entire knowledge base to a third party.

## Why now

Two YC RFSs (2026) describe pieces of what Memex is:

- **["The AI Operating System for Companies"](https://www.ycombinator.com/rfs#ai-operating-system-for-companies)** by Diana Hu — the queryable substrate, the closed loop between intent and reality.
- **["Company Brain"](https://www.ycombinator.com/rfs#company-brain)** by Tom Blomfield — the procedural extraction layer that turns scattered artifacts into executable skills.

These are complementary, not redundant. Hu describes the substrate; Blomfield describes what you build on top. Memex claims both.

---

## Architecture (the short version)

| Layer | Choice |
|---|---|
| Web/API | NestJS 11 (API) + Next.js 15 App Router (dashboard) |
| ORM | Drizzle on Postgres + pgvector ≥ 0.8 |
| Auth | Better Auth with `organization`, `apiKey`, `oauthProvider` plugins |
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

See [`docs/ROADMAP.md`](./docs/ROADMAP.md) for the full plan.

- **v0.1 — Substrate** *(weeks 1–4)* — monorepo, Drizzle schema, Better Auth, Slack connector end-to-end, basic search, MCP `search` + `fetch_document`.
- **v0.2 — Knowledge layer** *(weeks 5–8)* — GitHub + Notion, contextual chunking, hybrid RRF search, ACL enforcement.
- **v0.3 — Multi-source** *(weeks 9–12)* — Linear + Google Workspace + meeting transcripts (Granola), all eight MCP retrieval tools, OAuth 2.1 with DCR.
- **v0.4 — Self-host polish** *(weeks 13–16)* — Railway template, Coolify guide, audit log, first public release.
- **v0.5 — Skills** *(weeks 17–22)* — procedural synthesis, `SKILL.md` generation, MCP `list_skills` / `get_skill` / `execute_skill`. The Company Brain layer.
- **v0.6 — Closed loop** *(weeks 23+)* — Plans/Intents subsystem, drift detection, "engineering is building the wrong thing" alerts.

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
