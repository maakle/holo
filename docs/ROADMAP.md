# Roadmap

The plan is to ship v0.0 internally at the founder's company in 5–6 weeks, then v0.1 (skills + public release) in 7–8 more weeks. Every milestone ends with a concrete demo and a definition of done. If a milestone slips, cut scope, don't extend the timeline.

This roadmap was substantially restructured on 2026-04-29. The earlier v0.1→v0.5 substrate-then-skills sequencing was abandoned. See [`decisions/0004-multi-agent-shared-context-wedge.md`](./decisions/0004-multi-agent-shared-context-wedge.md) for the reasoning.

## Guiding principles

- **Multi-agent dogfood first.** v0.0 must successfully migrate the founder's two existing custom agents (a Slack-triggered Cursor support-question agent and a Notion-based interview-prep agent) off their bespoke context fetchers onto memex's MCP endpoint. If it can't do that, the wedge isn't real.
- **Skills ship in v0.1, not v0.5.** The v0.1→v0.5 sequencing in earlier roadmaps was fatal — substrate alone is a commodity by 2026 (Onyx, Dust, PipesHub). Skills are the differentiator and ship in the same release as substrate.
- **Self-host on day one.** If it doesn't `docker compose up`, it doesn't ship.
- **MCP is the demo.** Every milestone ends with "point an existing custom agent at this MCP endpoint and watch it work."
- **Validate the wedge externally in parallel.** Cold-DM peer CTOs during v0.0 to confirm the multi-agent context-duplication pain exists outside the founder's company. The v0.1 *public* release does not ship without 2+ external responders confirming.

---

## v0.0 — Internal substrate (weeks 0–6)

**Goal:** memex runs at the founder's company as the unified context layer for the two existing custom agents and a new customer-success agent prototype. Not public yet. No external users.

**Demo (private):** "Both existing agents are running on memex's MCP endpoint with parity-or-better context quality. The customer-success agent prototype, built on top of Pylon + HubSpot data, produces useful output. Daily agent invocations across all 3 agents do not regress in latency by more than 30%."

**Internal-dogfood gate at week 6:** if both existing agents are running on memex with parity-or-better context quality AND the customer-success agent prototype is functional → proceed to v0.1. If the migration breaks an agent or the customer-success agent doesn't work, do *not* proceed; diagnose first.

### Week 1: Skeleton + codebase+KB cluster (revised after /plan-eng-review)
- [ ] Day 1–2: Verify Grain and Pylon have read APIs with sufficient rate limits for incremental ingestion. If either fails, replace with a stopgap (manual export script) or drop from v0.0 scope before any other work.
- [ ] Monorepo (`apps/`, `packages/`, pnpm workspaces, Turborepo)
- [ ] `apps/api` (NestJS) + `apps/worker` (NestJS standalone, BullMQ) + `apps/mcp` (Hono) + `apps/web` (Next.js, minimal)
- [ ] `packages/db` — Drizzle schema, initial migration. **Day-1 migration MUST include: HNSW index on embeddings vector, GIN on tsvector, GIN on `acl_subjects`, btree on `(source_type, ...)` composite.** Without these, queries silently degrade past 100K chunks.
- [ ] `packages/retrieval-core` — shared package between MCP and (v0.1) REST. **ESLint boundary rule: `apps/mcp` and `apps/api` cannot import `packages/db` directly; only via `packages/retrieval-core`.** Enforces DRY by construction (Issue 1B from /plan-eng-review).
- [ ] `packages/skills` and `packages/plans` exist as architectural placeholders
- [ ] `docker-compose.yml` runs Postgres + pgvector + Redis + the four apps
- [ ] CI runs lint + typecheck + tests on every PR
- [ ] **Better Auth in single-user mode** (login, session)
- [ ] **Connections page in `apps/web`** — one row per connector, "Connect" button → OAuth flow → "Connected ✓"
- [ ] **`connector_cursors` table + cursor logic** — per-connector incremental sync from day 1. No nightly full re-pulls; track `latest_seen_ts` per channel/repo/page (Issue 4A from /plan-eng-review). Slack rate-limit (50/min) and GitHub rate-limit (5000/hr) make full re-pulls unworkable past ~2 weeks of normal usage.
- [ ] **Ingestion-time allowlist enforcement** — config-driven allowlist per connector (Slack channels, GitHub repos, Notion page trees). Bot/integration sees its own permissions, but memex only ingests from allowlisted scopes. Defense against accidentally surfacing #legal / #hiring / #exec data via agents (Issue 1A from /plan-eng-review).
- [ ] **Slack + GitHub + Notion connectors end-to-end** (codebase+KB cluster). Notion moved up from week 2 so the support-question agent can fully migrate in week 1 (Issue 1C from /plan-eng-review).
- [ ] **MCP tools wired up:** `search`, `get_thread`, `get_pr`, `get_doc` working
- [ ] **Support-question agent migration:** point the agent at memex's `search` instead of its bespoke retriever; verify parity on 3 sample queries from the codebase+KB cluster (e.g., Jesse's MFA/retention questions, Mo's workable ID question, Maria's UKG Pro question)

### Week 2: Grain connector + interview-prep agent migration
- [ ] Grain connector (per-speaker turn chunks with timestamps, meeting-level summary chunk; uses cursor logic from week 1)
- [ ] MCP tool: `get_call`
- [ ] **Second migration:** point the interview-prep agent at memex; verify both existing agents now run on memex (note: Ashby is *not* in v0.0 scope per D23 — interview-prep migration covers Grain + Notion paths only, with Ashby data still served by the agent's existing fetcher)

### Weeks 3–4: Pylon + HubSpot connectors (customer cluster)
- [ ] Pylon connector (support tickets + conversation history)
- [ ] HubSpot connector (deals, deal sizes, sales context). Note: founder confirms HubSpot data is mirrored into Pylon today, so verify whether a separate HubSpot fetch adds value or whether Pylon's mirror is sufficient. If sufficient, drop the HubSpot connector from v0.0.
- [ ] MCP tool: `get_ticket` (with linked HubSpot deal data when present)
- [ ] **Support-question agent expansion:** customer-context queries (Ryan's "customers similar to EGYM", Konsti's "MrWork overages") now served by memex
- [ ] **New agent build:** customer-success agent prototype using Pylon + HubSpot context to draft replies / surface relevant deal context

### Week 5: Cross-source quality + observability
- [ ] Hybrid search (`pgvector` + `tsvector` fused with RRF, single SQL CTE) tuned across all 6 sources
- [ ] **v0.0 MCP tool surface = 6 tools:** `search`, `get_thread`, `get_pr`, `get_doc`, `get_call`, `get_ticket`. **Dropped from v0.0:** `whats_changed` and `list_recent_activity` (no agent query in scope needs them — defer to v0.1 if a real consumer materializes; Issue 2A from /plan-eng-review).
- [ ] Single-service-identity ACL documented as known limitation; ingestion allowlists are the v0.0 defense
- [ ] Internal observability: per-tool latency, query patterns, retrieval quality samples

### Week 6: Internal-dogfood gate
- [ ] All 3 agents (support-question, interview-prep, customer-success) running on memex daily
- [ ] Verify parity on the agents' real workload over a week
- [ ] Snapshot the v0.0 surface; freeze API for v0.1 build

---

## v0.1 — Skills + public release (weeks 7–14)

**Goal:** ship labeled-template skill synthesis, eval harness, and the first public release on GitHub Releases / GHCR. 3+ external CTOs running memex against their own data, with at least one running it for >2 weeks.

**Demo (public):** "memex extracted these 5 procedures from your last quarter of work; here's an existing custom agent invoking one of them via `get_skill` and `execute_skill`."

**Week 10 quality kill-switch:** if at least 3 of 5 extracted skills are NOT judged usable by the founder's team (binary: "would I let an agent invoke this?"), ship v0.1 as substrate-only and defer skills to v0.2. Do not delay the public release.

### Weeks 7–8: Skill eval harness *first*
- [ ] `skills` table with content, version, status, source artifacts, fingerprint, staleness fields
- [ ] Skill format = Anthropic Skill format (frontmatter + procedure + example tools), stored as Postgres rows (not filesystem artifacts)
- [ ] Hand-label a golden set of 10 procedures from the founder's team's actual data
- [ ] Build a regression test that scores extracted templates against the golden set on each prompt change
- [ ] **No prompt iteration on synthesis without the harness running** — otherwise quality regresses invisibly

### Weeks 8–10: Labeled-template synthesis
- [ ] User labels 5–10 example procedures ("this thread is a refund-handling procedure," "this PR is a security-review procedure")
- [ ] LLM extracts a parameterized template per label set; embedding-similarity match for new artifacts
- [ ] MCP tools: `list_skills(filter?)`, `get_skill(id)`
- [ ] Skill execution surface deferred to v0.2 (read-only in v0.1)
- [ ] **Free-form unsupervised extraction (variant a) is NOT in v0.1.** Deferred to v0.2 once the harness has more golden data.

### Week 10: Quality kill-switch
- [ ] Apply the 3-of-5-usable criterion. If pass → continue with skills in v0.1. If fail → ship v0.1 substrate-only, defer skills.

### Weeks 11–12: External onboarding + BYO-agent reach
- [ ] Better Auth `organization` plugin — multi-tenant signup, workspace creation, invite flow
- [ ] OAuth 2.1 with PKCE on the MCP server (static client; DCR optional, deferred to v0.2)
- [ ] **REST + OpenAPI surface** — auto-generated from NestJS controllers, sharing `packages/retrieval-core` with the MCP server. Endpoints mirror the MCP tool surface (`POST /v1/search`, `GET /v1/threads/:id`, `GET /v1/skills`, etc.). Static API key auth for v0.1; unified OAuth in v0.2.
- [ ] **Verified BYO-agent reach end-to-end:** demo a ChatGPT Action and a Gemini function call hitting the same memex instance an MCP client is using
- [ ] First 3+ external CTOs (selected from cold-DM responders during v0.0) onboarded
- [ ] Per-customer telemetry on agent retention and tool-call patterns
- [ ] Issue triage flow for early users

### Weeks 13–14: Release polish
- [ ] GHCR Docker image auto-published on tag
- [ ] README quickstart works first-try (no specific minute target)
- [ ] Public website + Discord
- [ ] Show HN draft, demo recording
- [ ] v0.1.0 release tag

---

## v0.2 — Self-host polish + free-form skills (weeks 15+)

Picked from observed v0.1 user need rather than pre-committed.

- [ ] Per-user OAuth ACL fan-out (Better Auth `oauthProvider` plugin) — agents inherit calling user's permissions
- [ ] Free-form unsupervised skill extraction (variant a), gated on the eval harness having broader coverage
- [ ] Railway + Coolify one-click templates
- [ ] Audit log surface for self-hosters
- [ ] `execute_skill` MCP tool (skill execution as workflow runs, not just read)
- [ ] DCR endpoint + consent UI (so MCP clients self-register without manual setup)
- [ ] Webhook-accelerated incremental sync (only if a v0.1 user hits a freshness pain that breaks an agent)

## Beyond v0.2

Picked from observed user need:

- **Drift detection** (the original v0.6 idea) — declare sprint goals / OKRs / PRDs, compare against actual artifacts, flag drift. Year-3 conversation, not on the near-term roadmap. Belongs in [`VISION.md`](./VISION.md) as long-run direction.
- **Long-tail connectors** — Linear, Google Workspace, Fathom, Fireflies, Salesforce, BambooHR. Added as v0.1 users ask.
- **Reranker on by default** if dogfooding shows latency is acceptable
- **Action tools in MCP** — write, not just read; agents can post to Slack, comment on PRs, create Linear issues
- **Agent marketplace** — pre-built skills shared across companies (community-contributed `handle_pagerduty_incident`, etc.)
- **Managed cloud offering** when v0.2 has 3+ paying self-host customers asking for it
- **Graph layer** (Apache AGE) when relational + `parent_id` is genuinely insufficient
- **ClickHouse for analytics** at >10M event rows
- **Multi-modal ingestion** — Figma designs, video, screenshots

---

## How we'll work

- One week = one milestone slice. Slip = cut scope.
- Every milestone ends with a demo recording (private during v0.0, public from v0.1).
- Issues live on the `Memex` GitHub Project. Tagged with milestone (`v0.0`, `v0.1`, `v0.2`) and area (`area:connectors`, `area:mcp`, `area:auth`, `area:retrieval`, `area:skills`, `area:web`, `area:infra`).
- ADRs in `docs/decisions/` for any non-obvious decision. The wedge reframe and roadmap restructure are documented in [`0004-multi-agent-shared-context-wedge.md`](./decisions/0004-multi-agent-shared-context-wedge.md).
- No private branches that live more than a week.
- **Parallel external validation track during v0.0:** founder cold-DMs 10 peer CTOs in week 1 with one question — *"How many custom AI agents does your team currently run in production, and what does building a new one cost in engineering time?"* — and tracks responses through week 4. v0.1 public release does not ship without 2+ responders confirming the multi-agent context-duplication pain.
