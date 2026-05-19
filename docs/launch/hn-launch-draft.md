# Show HN draft (from Reddit launch post)

A Hacker News version of the Reddit launch post. Tone shifted to HN conventions: no bold sub-headers, no emoji, lead with the concrete origin pain, understate the marketing, end with specific questions.

---

## Title (≤80 chars)

```
Show HN: Holo – Self-hosted shared context layer for AI agents (MCP + REST)
```

Alternates:

- `Show HN: Holo – One MCP endpoint your team's agents can share`
- `Show HN: Holo – Stop re-implementing context fetchers per agent`

---

## Body

Hi HN — I'm Mathias. I've been building [holo](https://github.com/maakle/holo) for the last few weeks and wanted feedback from people who self-host things and care about agent infrastructure.

The problem came out of one of my day jobs. We run several AI agents in production — a Slack support bot, an interview-prep agent, a customer-success draft-reply agent — and each one was re-implementing its own connector stack, its own retriever, its own "how do we handle X" prompts. Same Linear, same GitHub, same Notion, three bespoke ingestion pipelines, three different ACL stories, three different audit trails. We ended up building an internal shared context layer to fix it. I kept wondering why this didn't exist as open infrastructure for everyone else hitting the same wall, so I'm rebuilding it in the open, generalized, from scratch.

What it is: one MCP server (with a parallel REST/OpenAPI surface for the no-agent case) that ingests once from your connectors, indexes into a single ACL-aware Postgres store with pgvector, and exposes `search` / `fetch` / `invoke` to any MCP-compatible agent — Claude, Cursor, your own — plus the same primitives over plain HTTP for things like a Retool app or a Slack `/ask` command.

Twenty connectors live today:

- Code and PM: GitHub, GitLab, Linear, Jira, Asana
- Chat and meetings: Slack, Google Chat, Grain
- Docs and knowledge: Notion, Confluence, Mintlify Docs, Prismic, Firecrawl-backed webcrawl
- Files: Google Drive, Airtable
- GTM: HubSpot, Salesforce, Stripe
- Support: Zendesk Help Center, Pylon

Stack: TypeScript monorepo with three apps (Next.js dashboard, Hono gateway, NestJS worker on BullMQ). Postgres with pgvector and pg_trgm for hybrid retrieval, Redis for queues, Drizzle ORM, Better Auth (GitHub + email OTP, multi-tenant orgs from day one). Dual-model embedding fallback across OpenAPI and Voyage. A `step()` checkpoint helper in the worker so ingestion jobs are crash-resumable instead of restarting a 200k-doc Notion sync from zero. `docker compose up -d` for local; a one-click Railway template is in progress.

It's an OAuth 2.1 + PKCE provider with Dynamic Client Registration (RFC 7591 / 8414 / 9728), so MCP clients can discover and connect without me hand-issuing tokens. Every call is logged — who asked, what tools fired, what context grounded the answer — with a read-only replay view that shows the recorded query and result diff (not live re-execution).

License is AGPL-3.0. Self-host freely; if you fork and run it as a service, share the changes back. CLA on first PR.

What it isn't, honestly:

- Pre-alpha. Not production-ready. I'm dogfooding it.
- Not a replacement for Onyx or Dust if all you want is enterprise search Q&A. Holo's wedge is the multi-agent case — the layer your agents plug into, not the chatbot you give your team.
- The skills/marketplace UI ships as 501 stubs for v0.1. The plumbing is in the repo (`packages/skills/`, `packages/discovery/`, `procedure_*` tables) but the routes are off until there's enough cross-connector signal from real usage to make procedure synthesis worth shipping.
- Replay is a recorded query+result diff, not live re-execution against current state.
- I'm one person rebuilding what a team did internally. Some of this has rough edges. PRs welcome.

Two things I'd genuinely like feedback on:

1. Does an MCP-shaped shared context layer feel like the right primitive, or is "every agent owns its own context" just how this is going to shake out? Curious especially from anyone who's built this kind of thing internally and didn't open-source it — what did you regret about the design?
2. If your team is running multiple internal agents today, where is the duplication actually painful — connectors, retrieval, ACL, audit, something else?

Repo: https://github.com/maakle/holo
Site: https://holobase.dev/

Happy to answer architecture questions — why Postgres-only hybrid instead of a separate vector DB, why AGPL instead of MIT-with-EE, how the OAuth DCR flow is wired, how the worker checkpointing handles partial syncs, anything.

---

## Anticipated threads

**"Why not Onyx / Dust / PipesHub?"**
> Unified search Q&A is a commodity at this point. Holo's bet is on the multi-agent case: the same chunks, ACL, and audit log feeding every agent your team ships, not a chatbot. If all you need is "let employees ask questions over our docs," Onyx is great and you should use it.

**"Why Postgres + pgvector instead of Qdrant / Pinecone / Weaviate?"**
> One piece of infra to operate instead of two. A single SQL CTE fusing pgvector cosine and tsvector ranking with RRF has been fast enough for the scale I'm running. If I hit a wall I can move the vector tier later. ADR is in `docs/decisions/`.

**"AGPL is a non-starter for us."**
> Self-host inside your company is fine — AGPL only triggers when you offer it as a network service to third parties, in which case you publish your modifications. If that's still a blocker, open an issue and tell me what model you'd accept; I'd rather know now.

**"How do you handle prompt injection in retrieved Slack messages or webpages?"**
> Today: ingestion-time allowlists in the connector spec are the v0.1 defense — channels and repos you don't allow simply never enter holo. Per-user OAuth fan-out (so agents see only what the calling user can see) is shipped for Slack and rolling to the rest. Per-skill `toolAllowlist` enforcement at the gateway is the next slice.

**"What's the actual wedge over rolling my own?"**
> Connector maintenance and ACL plumbing across 20 sources is what eats the time. If you only need one or two sources you probably should roll your own. The wedge is the team that already has three agents and a fourth on the roadmap.

**"You shipped this fast. Are you sure?"**
> No — that's why it's pre-alpha and AGPL'd in public instead of a managed launch. The point of this post is to find out where the assumptions break before I sink another month in.

---

## Don't-post-without checklist

- [ ] Title ≤80 chars, no marketing adjectives.
- [ ] No emoji.
- [ ] Repo README quickstart works first-try on a fresh macOS install — re-verify the morning of posting.
- [ ] GitHub Discussions open with visible categories.
- [ ] At a keyboard for the next ~6 hours after posting.
- [ ] Connector count in the body matches what's actually live on `main`.
- [ ] License statement matches `LICENSE` on the day of posting.
