# Roadmap

The plan is to ship a usable v0.1 in 4 weeks, then iterate publicly. v0.5 is when Memex stops being a search product and becomes the Company Brain. v0.6 closes the loop. Every milestone has a concrete demo and a definition of done. If a milestone slips, cut scope, don't extend the timeline.

## Guiding principles

- **Slack first, always.** Every connector decision is validated against Slack before being generalized.
- **Self-host on day one.** If it doesn't `docker compose up`, it doesn't ship.
- **MCP is the demo.** Every milestone ends with "connect Claude Desktop and try this query (or skill)."
- **Eat your own dog food.** Connect Memex to Memex's own Slack, Linear, GitHub, Notion, Granola. The first user is us.
- **Skills are the product, not a v2 nice-to-have.** Architecture supports them from v0.1; they ship in v0.5.

---

## v0.1 — Substrate (weeks 1–4)

**Demo:** "Connect a Slack workspace. Watch it sync. Open Claude Desktop, ask a question about a thread, get an answer with the source linked."

### Week 1: Skeleton
- [ ] Monorepo (`apps/`, `packages/`, pnpm workspaces, Turborepo)
- [ ] `apps/api` boots with NestJS, health endpoint, OpenAPI auto-generated
- [ ] `apps/web` boots with Next.js 15 App Router, shadcn, Tailwind
- [ ] `apps/worker` boots, NestJS standalone, BullMQ "hello world" job
- [ ] `apps/mcp` boots with Hono, streams a `ping` tool
- [ ] `packages/db` — Drizzle schema, initial migration: `workspaces`, `users`, `sessions`
- [ ] `packages/skills` and `packages/plans` exist as stub folders with README explaining future contents (architectural placeholders)
- [ ] `docker-compose.yml` runs Postgres + pgvector + Redis + all four apps
- [ ] CI runs lint + typecheck + tests on every PR

### Week 2: Auth and workspaces
- [ ] Better Auth integrated with `organization` and `apiKey` plugins
- [ ] Sign-up / sign-in flows (email + GitHub OAuth)
- [ ] Workspace creation, invite flow, member list
- [ ] API key generation UI, revocation, last-used timestamp
- [ ] `ApiKeyGuard` and `SessionGuard` in `apps/api`
- [ ] Audit log table, every authenticated request writes a row

### Week 3: Slack connector end-to-end
- [ ] `Connector<>` interface defined
- [ ] Slack OAuth install flow, token storage with envelope encryption
- [ ] `fullSync`: channels → threads → messages, paginated, with checkpoints
- [ ] `incrementalSync` using `oldest` cursor per channel
- [ ] Webhook receiver: HMAC verify, idempotency, enqueue
- [ ] Mention/channel resolution before embedding
- [ ] Thread-as-document chunking
- [ ] `connections`, `documents`, `chunks` tables

### Week 4: Search and MCP
- [ ] Embedding pipeline: `text-embedding-3-large` truncated to 1024 dims, pluggable
- [ ] Hybrid search: pgvector + tsvector fused with RRF, single SQL CTE
- [ ] `POST /v1/search` returning chunks with provenance
- [ ] MCP `search` and `fetch_document` tools
- [ ] OAuth 2.1 + PKCE on the MCP server (static client, no DCR yet)
- [ ] Connections page in dashboard with sync progress
- [ ] First public demo: README quickstart works end-to-end

---

## v0.2 — Knowledge layer (weeks 5–8)

**Demo:** "Three connectors syncing continuously. Hybrid search returns relevant chunks across them. ACLs respected — a user can't retrieve content they can't see in the source."

- [ ] **Week 5: Contextual chunking** — Anthropic-style situating blurbs, prompt caching for parents, re-embedding job
- [ ] **Week 6: GitHub connector** — GitHub App, repos→PRs→reviews→issues, three-chunk PR strategy, code embeddings
- [ ] **Week 7: Notion connector** — OAuth, databases→pages→blocks, breadcrumb prefixing, search-index API
- [ ] **Week 8: ACL enforcement** — `acl_subjects` GIN index, per-connector extractors, user subject resolver, audit on every retrieval, RLS, permission preview tool

---

## v0.3 — Multi-source + transcripts (weeks 9–12)

**Demo:** "Linear, Google Workspace, and Granola transcripts ingested. Claude Desktop can reach all of it. OAuth 2.1 + DCR works — Claude registers itself with no manual setup. `who_knows_about` correctly identifies subject-matter experts based on call participation."

### Week 9: Linear + Google Workspace
- [ ] Linear: issues + comments, OAuth, webhook
- [ ] Google Workspace: Drive (`changes.list`), Gmail (`history.list`), Docs/Sheets/Slides
- [ ] Per-source chunking strategies finalized

### Week 10: Meeting transcripts
- [ ] Granola connector first (founder uses it)
- [ ] Per-speaker turn chunks with timestamps
- [ ] Meeting-level summary chunk for navigational queries
- [ ] Speakers as ACL subjects
- [ ] Decision-extraction pipeline as a downstream job (decisions made on calls become first-class records)
- [ ] Fathom and Fireflies as fast-follows

### Week 11: All eight retrieval MCP tools
- [ ] `search`, `fetch_document`, `list_recent` (generic)
- [ ] `get_slack_thread`, `get_pr`, `get_notion_page`, `get_linear_issue`, `get_meeting`
- [ ] `who_knows_about` (uses participation across threads, PRs, calls)
- [ ] All tools annotated with `readOnlyHint`, `idempotentHint`, `openWorldHint`
- [ ] Output schemas via Zod v4

### Week 12: OAuth 2.1 provider with DCR
- [ ] Better Auth `oauthProvider` plugin configured
- [ ] Dynamic Client Registration endpoint
- [ ] Protected Resource Metadata + Authorization Server Metadata
- [ ] Consent UI in dashboard
- [ ] Per-`(workspace, user, agent)` token scoping

---

## v0.4 — Self-host polish + first public release (weeks 13–16)

**Demo:** "One-click Railway deploy. Coolify guide. Self-hosters joining Discord. First non-team user successfully running production."

- [ ] **Week 13: Deployment** — Railway template, Coolify guide, VPS guide with Caddy
- [ ] **Week 14: Operational maturity** — Health checks, Prometheus metrics, structured logging, OTel traces, backup/restore docs
- [ ] **Week 15: Documentation** — Nextra docs site, per-connector setup guides, MCP integration guides
- [ ] **Week 16: Launch** — public website, Show HN draft, Discord, demo video, v0.4.0 release

This is the moment Memex is publicly usable as the substrate. From here, the differentiation begins.

---

## v0.5 — Skills (weeks 17–22)

**Demo:** "Memex synthesizes a `handle_customer_refund` skill from 47 Slack threads, 3 Notion pages, and 12 PRs. Workspace admin reviews and promotes it. Claude Desktop discovers the skill via `list_skills`, fetches it via `get_skill`, and executes it via `execute_skill` — Memex records the run, the agent does the work."

The transition from *search product* to *Company Brain* happens in this milestone.

### Week 17: Skill data model and storage
- [ ] `skills` table with content, version, status, source artifacts, fingerprint, staleness
- [ ] `skill_runs` table linked to `workflow_runs`
- [ ] Skill format documented (frontmatter + procedure + example tools, matching Anthropic's Skill format)
- [ ] CRUD UI for skills in dashboard
- [ ] ADR `0003-skills-on-top-of-substrate.md`

### Week 18: Synthesis worker
- [ ] `SkillSynthesizer` worker invoked by user request ("synthesize a skill for X")
- [ ] Multi-pass retrieval to gather all relevant artifacts
- [ ] LLM-driven extraction with templated prompt
- [ ] `sourceFingerprint` computed and stored
- [ ] Output as structured `SKILL.md` content
- [ ] Skills emitted in `draft` state by default

### Week 19: Skill review + promotion
- [ ] Admin UI: list draft skills, diff against previous version, edit, promote to `active`
- [ ] Skill versioning — promoting creates a new version, preserves history
- [ ] Deprecation flow

### Week 20: Skill freshness
- [ ] Background job: when source artifacts change, mark skills `stale`
- [ ] Auto-resynthesis for `stale` skills (still emitted as `draft` for review)
- [ ] Notification flow for skill maintainers

### Week 21: MCP skill tools
- [ ] `list_skills` with descriptions, ACL-filtered
- [ ] `get_skill` returning full content
- [ ] `execute_skill` invoking the procedure as a `workflow_run`, returning step-by-step trace
- [ ] `execute_skill` requires explicit user approval (not auto-approvable)
- [ ] Tool annotations updated

### Week 22: Skill evaluation harness
- [ ] LLM-as-judge eval framework for synthesis quality
- [ ] Per-skill golden datasets — known-good inputs, known-good outputs
- [ ] Skill execution feedback (thumbs-up/down) flows back into prompts
- [ ] First public demo of skills: announce v0.5

---

## v0.6+ — Closed loop (weeks 23+)

**Demo:** "Workspace declares a sprint goal. Memex reads linked Linear issues, GitHub PRs, Slack threads. Surfaces a drift report: 'feature X was committed to but engineering has been working on Y for the last 3 days.' Engineering team acts on it."

This is Hu's "engineering is building the wrong thing" alert.

- **Plans / Intents data model** — `plans` table holding sprint goals, OKRs, PRDs, runbooks as first-class records
- **Plan ingestion** — declared via dashboard, optionally synced from Linear cycles or Notion templates
- **Drift detector worker** — scans linked artifacts, compares state against plan, emits `drift_reports`
- **Drift dashboard** — surface to humans
- **MCP tools** — `list_plans`, `get_plan`, `get_drift`
- **Closed-loop UX** — drift triggers Slack/email notifications; users can mark drift reports as accepted/rejected for tuning

The architecture leaves space for this (`packages/plans` exists from v0.1) but the implementation is deferred until skills are solid.

---

## Beyond v0.6

Picked from observed user need:

- **Inngest self-hosted migration** when durable workflows need event waits
- **Reranker on by default** if dogfooding shows latency is acceptable
- **Long-tail connectors via Nango adapter**: BambooHR, Salesforce, HubSpot
- **Action tools in MCP** — write, not just read; agents can post to Slack, comment on PRs, create Linear issues
- **Agent marketplace** — pre-built skills shared across companies (community-contributed `handle_pagerduty_incident.md`, etc.)
- **Graph layer** (Apache AGE) when relational + `parent_id` is genuinely insufficient
- **ClickHouse for analytics** at >10M event rows
- **Multi-modal ingestion** — figma designs, video, screenshots

---

## How we'll work

- One week = one milestone slice. Slip = cut scope.
- Every milestone ends with a demo recording posted to Discussions.
- Issues live on the `Memex` GitHub Project. Tagged with milestone (`v0.1`, `v0.5`, …) and area (`area:connectors`, `area:mcp`, `area:auth`, `area:retrieval`, `area:skills`, `area:plans`, `area:web`, `area:infra`).
- ADRs in `docs/decisions/` for any non-obvious decision.
- No private branches that live more than a week.
