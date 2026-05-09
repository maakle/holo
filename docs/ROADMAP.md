# Roadmap

The plan is to ship v0.0 internally at the founder's company in 5–6 weeks, then v0.1 (skills + public release) in 7–8 more weeks. Every milestone ends with a concrete demo and a definition of done. If a milestone slips, cut scope, don't extend the timeline.

This roadmap was substantially restructured on 2026-04-29. The earlier v0.1→v0.5 context layer-then-skills sequencing was abandoned. See [`decisions/0004-multi-agent-shared-context-wedge.md`](./decisions/0004-multi-agent-shared-context-wedge.md) for the reasoning.

## Three pillars

Every milestone below advances one of three pillars. Each pillar must be visibly present at v0.1 launch, even if shallowly:

1. **Context layer** — connectors, ingestion, hybrid search, MCP + REST/OpenAPI surface. The thing every agent plugs into.
2. **Procedures** — labeled-template synthesis, eval harness, public marketplace. The differentiator over generic unified-search.
3. **Governance** — scoped personas (connection / tool / data scopes), observability, audit, replay. The reason a security-conscious buyer will let agents near production data.

If a milestone slips, cut scope inside a pillar. Do not drop a pillar.

---

## Status snapshot — 2026-05-09

This section is hand-maintained alongside CHANGELOG.md. The per-week checkboxes below in v0.0 and v0.1 are the *original plan*; this snapshot is the source of truth for what has actually shipped.

### v0.0 — Internal context layer · **complete**

Built and live at the founder's company. The three internal agents (support-question, interview-prep, customer-success) are running on holo's MCP endpoint.

- Monorepo: `apps/web` (Next.js), `apps/mcp` (Hono — MCP JSON-RPC + REST/OpenAPI; renamed from `apps/gateway`), `apps/worker` (BullMQ).
- `packages/db` with Drizzle, pgvector + GIN/HNSW indexes, migrations.
- `packages/retrieval-core` shared between MCP and REST. ESLint boundary rule enforced.
- `packages/errors` with `HoloError` + `local/no-bare-throw-error` ESLint rule.
- `packages/chunker`, `packages/embedder`, `packages/llm`, `packages/connector-framework`, `packages/sync-providers`, `packages/crypto`, `packages/audit`, `packages/env`.
- `docker-compose.yml` boots Postgres + pgvector + Redis + apps. CI runs lint + typecheck + tests on every PR.
- Better Auth single-user mode → multi-tenant `organization` plugin (workspace creation, invite links, member roles, leave workspace, branded HTML emails).
- Connections page (one row per connector, OAuth flow, last-sync, disconnect).
- `connector_cursors` + per-provider sync cadence in `packages/connectors/src/sync-intervals.ts`.
- Ingestion-time allowlist enforcement (`connector_allowlists` table + per-connector gating tests).
- **9 connectors live (v0.0 spec called for 6):** Slack, GitHub, Notion, Grain, Pylon, HubSpot, plus Linear, Mintlify Docs, Zendesk Help Center.
- MCP tool surface: `search`, `get_thread`, `get_pr`, `get_doc`, `get_call`, `get_ticket`.
- Hybrid search (pgvector + tsvector fused with RRF in a single SQL CTE).
- Audit log table + interceptor; paginated audit-log UI.
- Internal observability: per-tool latency, sync throughput charts, invocation charts, sample-data discoverability.

### v0.1 — Public release · **in progress**

Skill synthesis foundation and OS surface partially shipped. Public release not cut.

**Shipped:**
- `packages/skills` — types, synthesizer, eval harness, executor, redactor, golden set, tests.
- REST + OpenAPI surface generated from `@hono/zod-openapi` schemas; mirrors MCP tool surface; Scalar reference at `/docs`.
- Static API-token auth (`api_token` table) for v0.1 BYO-agent reach.
- "Connect your agent" panel in `apps/web` with pre-formatted config blobs (Cursor, Claude Desktop, Cline, curl, Python, TypeScript) and one-click copy.
- Dashboard charts: agent invocations, sync throughput, sample-data state, dynamic range selection.
- ESLint hardened (`no-explicit-any` promoted to error, `withActiveOrg` wrapper, strict `resolveActiveOrgId`).
- Test coverage (per `TODOS.md` item 1): allowlist enforcement, per-connector ingestion + retrieval, hybrid-search parity, `HoloError` golden-set — all ✅. Connections-page OAuth E2E 🟡 partial; "Connect your agent" snapshot tests ⏸ deferred.

**Still to ship before v0.1.0 tag:**
- [ ] OAuth 2.1 with PKCE on the MCP server (static client; *shipped early in v0.3 — see below*).
- [ ] BYO-agent reach demo end-to-end with a ChatGPT Action and a Gemini function call hitting the same holo instance.
- [ ] Skill marketplace stub (CP1): `/skills` registry, two-stage publish with redaction diff, AGPL-3.0 contribution license, takedown email + rate limit.
- [ ] Agent observability dashboard + read-only replay diff (CP2).
- [ ] `npx holo init` (CP3 + DX D44/D48): macOS + Linux quickstart, GitHub-only at install, ≤30s TTFUQ target, opt-in TTHW telemetry.
- [ ] GHCR Docker image auto-published on tag.
- [ ] GitHub Discussions enabled (DX D47) — `Q&A` / `Feature requests` / `Show & tell` / `Connectors`.
- [ ] Show HN draft + demo recording.
- [ ] First 3+ external CTOs onboarded with ≥1 running >2 weeks.
- [ ] Skill quality kill-switch: 3-of-5-usable criterion against the golden set (decides whether v0.1 ships skills or context-layer-only).

### v0.2 — Self-host polish + free-form skills · **partial**

Some v0.2 items shipped early on `claude/holo-v0.3-*` branches; others still open.

**Shipped (mostly on v0.3 branches per `CHANGELOG.md`):**
- Real OAuth 2.1 + PKCE provider (`@holo/oauth-provider`), replacing the v0.2 single-tenant DCR/authorize/token stubs.
- Per-user OAuth ACL fan-out — **Slack only**. `slack_user_credentials`, `user_subjects_cache`, `@holo/user-subjects`, 30-min worker cron, MCP `userSubjects` fan-out.
- CLI-as-tool registration (`packages/cli` commands: `tool register/list/show/unregister`). See `docs/superpowers/specs/2026-05-01-cli-as-tool-registration-design.md`.

**Still open:**
- [ ] Per-user OAuth fan-out for Notion, GitHub, Grain, Pylon (each its own follow-up slice).
- [ ] MCP authorization granularity proxy — per-skill `toolAllowlist` enforcement at the proxy layer (`TODOS.md` item 6).
- [ ] GitHub Actions ingestion mode — `maakle/holo-sync@v1` wrapping the worker code-path (`TODOS.md` item 7).
- [ ] Free-form unsupervised skill extraction (variant a), gated on broader golden-set coverage.
- [ ] Replay live-execution with per-tool effect classification (`TODOS.md` item 5).
- [ ] Windows support for `npx holo init`.
- [ ] Railway + Coolify one-click templates.
- [ ] Managed cloud beta.
- [ ] Audit log surface for self-hosters (currently table-only, no UI for non-founder ops).
- [ ] `execute_skill` MCP tool (skill execution as workflow runs, not just read).
- [ ] DCR endpoint + consent UI for self-registering MCP clients.
- [ ] Webhook-accelerated incremental sync (gated on a v0.1 user hitting freshness pain).
- [ ] Productize agent templates (CP4) — `packages/agent-templates/` + `holo use-template` (`TODOS.md` item 4).
- [ ] Refresh tokens (currently 24h plain bearer; clients re-authorize on expiry).
- [ ] Token-level scope enforcement beyond presence.
- [ ] Slack subjects TTL admin UI (currently hardcoded 30 min).
- [ ] `mcp-remote`-style proxy for clients without native OAuth.

---

## Guiding principles

- **Multi-agent dogfood first.** v0.0 must successfully migrate the founder's two existing custom agents (a Slack-triggered Cursor support-question agent and a Notion-based interview-prep agent) off their bespoke context fetchers onto holo's MCP endpoint. If it can't do that, the wedge isn't real.
- **Skills ship in v0.1, not v0.5.** The v0.1→v0.5 sequencing in earlier roadmaps was fatal — context layer alone is a commodity by 2026 (Onyx, Dust, PipesHub). Skills are the differentiator and ship in the same release as context layer.
- **Self-host on day one.** If it doesn't `docker compose up`, it doesn't ship.
- **MCP is the demo.** Every milestone ends with "point an existing custom agent at this MCP endpoint and watch it work."
- **Validate the wedge externally in parallel.** Cold-DM peer CTOs during v0.0 to confirm the multi-agent context-duplication pain exists outside the founder's company. The v0.1 *public* release does not ship without 2+ external responders confirming.

---

## v0.0 — Internal context layer (weeks 0–6)

**Goal:** holo runs at the founder's company as the unified context layer for the two existing custom agents and a new customer-success agent prototype. Not public yet. No external users.

**Demo (private):** "Both existing agents are running on holo's MCP endpoint with parity-or-better context quality. The customer-success agent prototype, built on top of Pylon + HubSpot data, produces useful output. Daily agent invocations across all 3 agents do not regress in latency by more than 30%."

**Internal-dogfood gate at week 6:** if both existing agents are running on holo with parity-or-better context quality AND the customer-success agent prototype is functional → proceed to v0.1. If the migration breaks an agent or the customer-success agent doesn't work, do *not* proceed; diagnose first.

### Week 1: Skeleton + codebase+KB cluster (revised after /plan-eng-review)
- [ ] Day 1–2: Verify Grain and Pylon have read APIs with sufficient rate limits for incremental ingestion. If either fails, replace with a stopgap (manual export script) or drop from v0.0 scope before any other work.
- [ ] Monorepo (`apps/`, `packages/`, pnpm workspaces, Turborepo)
- [x] `apps/web` (Next.js — dashboard + marketing + auth callbacks) + `apps/gateway` (Hono — MCP JSON-RPC + OpenAPI/REST) + `apps/worker` (BullMQ ingestion). Earlier drafts had `apps/api` (NestJS); deleted in PR #10 — the API tier folded into the gateway.
- [ ] `packages/db` — Drizzle schema, initial migration. **Day-1 migration MUST include: HNSW index on embeddings vector, GIN on tsvector, GIN on `acl_subjects`, btree on `(source_type, ...)` composite.** Without these, queries silently degrade past 100K chunks.
- [x] `packages/retrieval-core` — shared package powering both MCP and REST surfaces (now co-located in `apps/gateway`). **ESLint boundary rule: `apps/gateway` cannot import `packages/db` directly; only via `packages/retrieval-core`.** Enforces DRY by construction (Issue 1B from /plan-eng-review).
- [x] **`packages/errors` — `HoloError` class (DX D46):** structured error format used everywhere (apps/web, apps/gateway, apps/worker, packages/retrieval-core). Each error has `code`, `problem`, `cause`, `fix`, `docs_url`. ESLint rule (`eslint-plugin-local/rules/no-bare-throw-error.js`) against bare `throw new Error()` outside `packages/errors`. Foundational pattern; lands week 1 so every subsequent error site uses it.
- [ ] `packages/skills` and `packages/plans` exist as architectural placeholders
- [ ] `docker-compose.yml` runs Postgres + pgvector + Redis + the four apps
- [ ] CI runs lint + typecheck + tests on every PR
- [ ] **Better Auth in single-user mode** (login, session) — **GitHub OAuth + email magic link / OTP** as login methods
- [ ] **Connections page in `apps/web`** — one row per connector, "Connect" button → OAuth flow → "Connected ✓"
- [ ] **`connector_cursors` table + cursor logic** — per-connector incremental sync from day 1. No nightly full re-pulls; track `latest_seen_ts` per channel/repo/page (Issue 4A from /plan-eng-review). Slack rate-limit (50/min) and GitHub rate-limit (5000/hr) make full re-pulls unworkable past ~2 weeks of normal usage.
- [ ] **Ingestion-time allowlist enforcement** — config-driven allowlist per connector (Slack channels, GitHub repos, Notion page trees). Bot/integration sees its own permissions, but holo only ingests from allowlisted scopes. Defense against accidentally surfacing #legal / #hiring / #exec data via agents (Issue 1A from /plan-eng-review).
- [ ] **Slack + GitHub + Notion connectors end-to-end** (codebase+KB cluster). Notion moved up from week 2 so the support-question agent can fully migrate in week 1 (Issue 1C from /plan-eng-review).
- [ ] **MCP tools wired up:** `search`, `get_thread`, `get_pr`, `get_doc` working
- [ ] **Support-question agent migration:** point the agent at holo's `search` instead of its bespoke retriever; verify parity on 3 sample queries from the codebase+KB cluster (e.g., Jesse's MFA/retention questions, Mo's workable ID question, Maria's UKG Pro question)

### Week 2: Grain connector + interview-prep agent migration
- [ ] Grain connector (per-speaker turn chunks with timestamps, meeting-level summary chunk; uses cursor logic from week 1)
- [ ] MCP tool: `get_call`
- [ ] **Second migration:** point the interview-prep agent at holo; verify both existing agents now run on holo (note: Ashby is *not* in v0.0 scope per D23 — interview-prep migration covers Grain + Notion paths only, with Ashby data still served by the agent's existing fetcher)

### Weeks 3–4: Pylon + HubSpot connectors (customer cluster)
- [ ] Pylon connector (support tickets + conversation history)
- [ ] HubSpot connector (deals, deal sizes, sales context). Note: founder confirms HubSpot data is mirrored into Pylon today, so verify whether a separate HubSpot fetch adds value or whether Pylon's mirror is sufficient. If sufficient, drop the HubSpot connector from v0.0.
- [ ] MCP tool: `get_ticket` (with linked HubSpot deal data when present)
- [ ] **Support-question agent expansion:** customer-context queries (Ryan's "customers similar to EGYM", Konsti's "MrWork overages") now served by holo
- [ ] **New agent build:** customer-success agent prototype using Pylon + HubSpot context to draft replies / surface relevant deal context

### Week 5: Cross-source quality + observability
- [ ] Hybrid search (`pgvector` + `tsvector` fused with RRF, single SQL CTE) tuned across all 6 sources
- [ ] **v0.0 MCP tool surface = 6 tools:** `search`, `get_thread`, `get_pr`, `get_doc`, `get_call`, `get_ticket`. **Dropped from v0.0:** `whats_changed` and `list_recent_activity` (no agent query in scope needs them — defer to v0.1 if a real consumer materializes; Issue 2A from /plan-eng-review).
- [ ] Single-service-identity ACL documented as known limitation; ingestion allowlists are the v0.0 defense
- [ ] Internal observability: per-tool latency, query patterns, retrieval quality samples

### Week 6: Internal-dogfood gate
- [ ] All 3 agents (support-question, interview-prep, customer-success) running on holo daily
- [ ] Verify parity on the agents' real workload over a week
- [ ] Snapshot the v0.0 surface; freeze API for v0.1 build

---

## v0.1 — Skills + public release + OS surface (weeks 7–17, ~10–11 weeks)

Expanded after [/plan-ceo-review](../docs/designs/holo-v01-yc-prep.md) accepted 3 cherry-picks: skill marketplace stub, agent observability dashboard with read-only replay diff, and `npx holo init`. Timeline is honest: 7–8 weeks of original v0.1 + ~2.5 weeks of CP work + 1 week buffer = 10–11 weeks total.

**Goal:** ship labeled-template skill synthesis + eval harness + the OS surface (observability + marketplace) + the OSS adoption story (`npx holo init`) + first public release on GitHub Releases / GHCR. 3+ external CTOs running holo against their own data; ≥1 running it for >2 weeks.

**Demo (public):** "Run `npx holo init` and have your first agent query in 2 minutes. Then watch the observability dashboard light up as your agents call holo. Click replay on any past invocation. Browse the public skill marketplace and see what other teams have already shared."

**Week 10 quality kill-switch:** if at least 3 of 5 extracted skills are NOT judged usable by the founder's team (binary: "would I let an agent invoke this?"), ship v0.1 as context layer-only and defer skills to v0.2. Do not delay the public release.

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
- [ ] Apply the 3-of-5-usable criterion. If pass → continue with skills in v0.1. If fail → ship v0.1 context layer-only, defer skills.

### Weeks 11–12: External onboarding + BYO-agent reach
- [ ] Better Auth `organization` plugin — multi-tenant signup, workspace creation, invite flow
- [ ] OAuth 2.1 with PKCE on the MCP server (static client; DCR optional, deferred to v0.2)
- [x] **REST + OpenAPI surface** — generated from `@hono/zod-openapi` schemas in `apps/gateway`, sharing `packages/retrieval-core` with the MCP JSON-RPC handler. Endpoints mirror the MCP tool surface (`POST /v1/search`, `GET /v1/threads/:id`, `GET /v1/skills`, etc.). Scalar API reference at `/docs`. Static API-key auth (api_token table) for v0.1; unified OAuth (DCR) shipped in v0.2.
- [ ] **Verified BYO-agent reach end-to-end:** demo a ChatGPT Action and a Gemini function call hitting the same holo instance an MCP client is using
- [ ] First 3+ external CTOs (selected from cold-DM responders during v0.0) onboarded
- [ ] Per-customer telemetry on agent retention and tool-call patterns
- [ ] Issue triage flow for early users

### Weeks 12–13: Skill marketplace stub (CP1 from /plan-ceo-review)
- [ ] `/skills` route in `apps/web` — public registry browse page (no auth required to read)
- [ ] "Publish anonymized" button on extracted skills (GitHub OAuth required to publish)
- [ ] **Two-stage publish:** automated LLM-redaction pass produces a diff; human reviews and confirms before anything goes public
- [ ] AGPL-3.0 contribution license; takedown email + rate limit (5 publishes/day per user)
- [ ] Define "skill" = YAML doc + redacted example outputs

### Weeks 13–14: Agent observability dashboard + read-only replay diff (CP2) + Connect-your-agent UX (DX D45)
- [ ] Page in `apps/web` showing last 100 agent invocations: timestamp, calling agent identity, tools called, latency, output preview
- [ ] **Replay v1 = side-by-side diff of recorded query and result.** Live re-execution deferred to v0.2 (gated on per-tool effect classification — no auto-replay of side-effecting tools)
- [ ] Every MCP call logs query+result (already required for observability)
- [ ] Per-CTO replay view metric (proxy for OS framing landing — see Success Metrics in CEO plan)
- [ ] **"Connect your agent" page in `apps/web` (DX D45):** auto-generates an API token; renders pre-formatted config blobs for Cursor, Claude Desktop, Cline, curl, Python, TypeScript with the token already substituted. Single "Copy" button per agent type. Removes the "which URL? which token?" friction. ~1–2 days; pairs with this section's dashboard work.

### Week 15: `npx holo init` + TTHW telemetry (CP3 + DX D44/D48)
- [ ] `holo` npm package (CLI dispatcher) — **macOS + Linux only for v0.1**. Subcommands: `init`, `--version`, `--help` in v0.1; `doctor`, `sync`, `query` reserved for v0.2+
- [ ] **GitHub-only quickstart at install (DX D44):** `holo init` connects only GitHub at install time. Other 5 connectors (Slack, Notion, Grain, Pylon, HubSpot) added later via the dashboard. Time-to-first-useful-query target: **≤ 30 seconds** after install completes.
- [ ] Scaffolds holo install: download, generate `.env` with safe defaults, prompt for required values (Anthropic API key, GitHub OAuth)
- [ ] Runs `docker compose up`, runs migrations, opens the Connections page on first GitHub connection
- [ ] Graceful error if Docker daemon isn't running (clear message + link to install instructions)
- [ ] **Opt-in TTHW telemetry (DX D48):** `holo init` records start timestamp; first successful MCP `search` call records finish timestamp. Anonymous install UUID + timestamps only, no data content. Opt-in prompt at install time, default ON with clear privacy explanation. Aggregated p50/p95 reported on the public docs landing page.

### Weeks 15–16: Release polish + integration QA buffer
- [ ] GHCR Docker image auto-published on tag
- [ ] README quickstart works first-try with `npx holo init` (target ≤ 30 seconds to first query, GitHub-only)
- [ ] Public website + **GitHub Discussions enabled (DX D47)** — primary community Q&A channel; no Discord in v0.1. Categories: `Q&A`, `Feature requests`, `Show & tell`, `Connectors`. Founder triages daily during launch + first month.
- [ ] Show HN draft, demo recording
- [ ] Integration QA across new surfaces (marketplace + observability + `npx holo init`)

### Week 17: v0.1.0 launch
- [ ] v0.1.0 release tag
- [ ] Show HN
- [ ] First 3+ external CTOs onboarded (selected from cold-DM responders during v0.0)

---

## v0.2 — Self-host polish + free-form skills + managed cloud (weeks 18+)

Picked from observed v0.1 user need rather than pre-committed.

- [x] Per-user OAuth ACL fan-out — agents inherit calling user's permissions. Hand-rolled OAuth 2.1 + PKCE provider replaces the v0.2 single-tenant DCR/authorize/token stubs; per-user Slack OAuth populates a `user_subjects_cache` table refreshed by a 30-min worker cron; MCP `userSubjects` now includes `org:<O>`, `user:<U>`, plus the user's cached subjects. **Slack-only fan-out in this slice** (other connectors continue to emit only `org:` subjects until their own follow-up). Shipped on `claude/holo-v0.3-per-user-oauth`.
- [ ] **MCP authorization granularity proxy** — holo's MCP layer enforces per-skill `toolAllowlist` (per ARCHITECTURE.md). Solves the "Pylon MCP can't restrict to internal-only methods" problem the founder's CTO surfaced. The proxy receives the agent's MCP tool call, looks up which skill is active, and rejects calls outside the allowlist. v0.2 work; depends on the v0.1 skill model with `toolAllowlist` already in place.
- [ ] **GitHub Actions ingestion mode** — ship `maakle/holo-sync@v1` as a GitHub Action wrapping the same ingestion code-path the worker runs. Lets teams already on GitHub Actions install holo without running the worker process. Same connectors, same chunking, different trigger.
- [x] **CLI-as-tool registration** — `holo tool register --command "<cli>" --scope "<scope>" --read-only` exposes a scoped CLI invocation as an MCP tool. Replaces the "production-DB connector" framing — instead of building per-database connectors, teams register a `bq query` or `psql` invocation with scoped credentials and holo serves it as `mcp.bigquery_query` or similar. Pattern observed working in the founder's CTO's MVP at scoped read-only-on-specific-datasets level. Shipped in `claude/holo-v0.3-cli-as-tool` — see `docs/superpowers/specs/2026-05-01-cli-as-tool-registration-design.md`.
- [ ] Free-form unsupervised skill extraction (variant a), gated on the eval harness having broader coverage
- [ ] Replay live-execution (v0.1 was read-only diff) — gated on per-tool effect classification (read-only vs side-effecting)
- [ ] Windows support for `npx holo init`
- [ ] Railway + Coolify one-click templates
- [ ] Managed cloud beta (same code, run by us — see [`holo-v01-yc-prep.md`](./designs/holo-v01-yc-prep.md) for business framing)
- [ ] Audit log surface for self-hosters
- [ ] `execute_skill` MCP tool (skill execution as workflow runs, not just read)
- [ ] DCR endpoint + consent UI (so MCP clients self-register without manual setup)
- [ ] Webhook-accelerated incremental sync (only if a v0.1 user hits a freshness pain that breaks an agent)
- [ ] Productize agent templates (CP4 deferred from /plan-ceo-review — once 3+ external CTOs ask for them)

## Next connections to build

Existing connectors (9): **Slack, GitHub, Notion, Grain, Pylon, HubSpot, Linear, Mintlify Docs, Zendesk Help Center.**

Below is the candidate list of the next 15 connectors, in rough priority order. Priority is set by (a) coverage gaps in the founder's company workflow, (b) repeated asks from cold-DMs and v0.1 onboarding conversations, and (c) what unblocks the largest segment of external CTOs at lowest engineering cost. Order is not commitment — pick from the top of the list as users request, and skip any whose API constraints make incremental sync unworkable (same week-1 verification rule as Grain/Pylon).

Each row sketches the canonical resources to ingest, the auth model, and the v0.0-style ACL story.

1. **Google Drive** — Docs, Sheets, Slides, plain files in shared drives. OAuth (Google). ACL fan-out via per-user Drive scopes; closes the "where my company actually keeps its docs" gap that Notion alone misses.
2. **Google Calendar** — events, attendees, descriptions, recurrence. OAuth. Lets agents reason about meeting context (who attended, what was on the agenda) and pairs naturally with Grain/Fathom.
3. **Gmail** — threads in user-allowlisted labels (e.g., `customer/*`, `support/*`). OAuth, per-user. High-value for customer-success agents; high-risk surface, so allowlist-by-label is mandatory.
4. **Atlassian Confluence** — spaces, pages, attachments. OAuth. The enterprise wiki for the half of buyers not on Notion. Same chunking shape as Notion.
5. **Atlassian Jira** — issues, comments, sprints, epics. OAuth. Pairs with Confluence; many incoming buyers run Jira even when they're on Slack + GitHub.
6. **Salesforce** — accounts, opportunities, contacts, activity timeline. OAuth. The CRM half of buyers use instead of HubSpot. Already flagged in "Beyond v0.2".
7. **Intercom** — conversations, contacts, articles. OAuth. Common alternative to Pylon/Zendesk for product-led companies.
8. **Microsoft Teams** — channels, chats, meeting transcripts. Microsoft Graph OAuth. Required for any enterprise buyer not on Slack.
9. **Microsoft 365 / SharePoint + OneDrive** — Office docs, SharePoint sites. Graph OAuth. Pairs with Teams; together they cover the Microsoft-first buyer.
10. **Outlook / Exchange Online** — mail in allowlisted folders. Graph OAuth. Same shape as Gmail; needed for the same buyers as Teams.
11. **GitLab** — projects, MRs, issues, wikis. OAuth or PAT. Code-host parity for buyers not on GitHub. Reuses most of the GitHub connector's chunking.
12. **Asana** — projects, tasks, comments. OAuth. PM-tool parity for teams not on Linear/Jira.
13. **Sentry** — issues, events, releases. OAuth. Lets incident-response agents pull recent error context without hand-rolled fetchers.
14. **PagerDuty** — incidents, services, on-call schedules. OAuth. Same incident-response use case as Sentry; pairs naturally.
15. **Fathom** — meeting recordings + transcripts. OAuth. Already flagged in "Beyond v0.2"; second meeting source after Grain so non-Grain buyers aren't blocked. Fireflies should follow on the same code-path (per-speaker turns + meeting-level summary chunk, mirrors the Grain shape).

**Connector implementation checklist** (every new connector must hit these — same gates as the existing 9):

- [ ] OAuth/API-key flow at `/api/connectors/<provider>/callback` or `/connect/<provider>`, encrypted via `HOLO_TOKEN_ENCRYPTION_KEY`.
- [ ] Provider added to `SYNC_PROVIDERS` in `packages/sync-providers` (web + CLI mirror).
- [ ] Per-provider sync cadence in `packages/connectors/src/sync-intervals.ts`.
- [ ] `connector_cursors` row + incremental-sync logic; no nightly full re-pulls.
- [ ] Allowlist enforcement at ingestion time (channels / repos / spaces / labels — provider-appropriate).
- [ ] Connector test in `packages/connectors/test/<provider>.test.ts` covering allowlist gating + retrieval round-trip.
- [ ] Connector setup guide in `docs/connectors/<provider>.md` linked from `docs/connectors/README.md`.
- [ ] At least one MCP tool surfaced (`get_<resource>`) where the resource shape is non-obvious from `search`.

---

## Beyond v0.2

Picked from observed user need:

- **Drift detection** (the original v0.6 idea) — declare sprint goals / OKRs / PRDs, compare against actual artifacts, flag drift. Year-3 conversation, not on the near-term roadmap. Belongs in [`VISION.md`](./VISION.md) as long-run direction.
- **Further long-tail connectors** beyond the 15 above — Fireflies, BambooHR, Greenhouse, Ashby, Stripe, Figma, Discord, Front, Help Scout, Freshdesk, Bitbucket, Datadog, Productboard, Coda, Airtable, GitBook, ReadMe, Loom, Zoom, Otter.ai. Added as v0.1+ users ask.
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
- Issues live on the `Holo` GitHub Project. Tagged with milestone (`v0.0`, `v0.1`, `v0.2`) and area (`area:connectors`, `area:mcp`, `area:auth`, `area:retrieval`, `area:skills`, `area:web`, `area:infra`).
- ADRs in `docs/decisions/` for any non-obvious decision. The wedge reframe and roadmap restructure are documented in [`0004-multi-agent-shared-context-wedge.md`](./decisions/0004-multi-agent-shared-context-wedge.md).
- No private branches that live more than a week.
- **Parallel external validation track during v0.0:** founder cold-DMs 10 peer CTOs in week 1 with one question — *"How many custom AI agents does your team currently run in production, and what does building a new one cost in engineering time?"* — and tracks responses through week 4. v0.1 public release does not ship without 2+ responders confirming the multi-agent context-duplication pain.
