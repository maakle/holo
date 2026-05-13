# Roadmap

v0.0 ships internally in 5–6 weeks; v0.1 (skills + public release) in 10–11 weeks after. Slip = cut scope, don't extend the timeline. Last restructured 2026-04-29 — see [ADR-0004](./decisions/0004-multi-agent-shared-context-wedge.md).

## Three pillars

Each must be visibly present at v0.1 launch:

1. **Context layer** — connectors, hybrid search, MCP + REST surface.
2. **Procedures** — labeled-template synthesis, eval harness, public marketplace.
3. **Governance** — scoped personas, observability, audit, replay.

Cut scope inside a pillar before dropping a pillar.

## Guiding principles

- **Multi-agent dogfood first.** v0.0 must migrate the founder's existing custom agents off bespoke retrievers onto holo's MCP endpoint.
- **Skills ship in v0.1**, not later — context layer alone is a commodity by 2026.
- **Self-host on day one.** If it doesn't `docker compose up`, it doesn't ship.
- **MCP is the demo.** Every milestone ends with "point an existing custom agent at this endpoint and watch it work."
- **Validate the wedge externally.** Cold-DM peer CTOs during v0.0; the v0.1 public release needs 2+ external responders confirming multi-agent context-duplication pain.

---

## Status — 2026-05-09

### v0.0 — Internal context layer · ✅ complete

Three internal agents (support-question, interview-prep, customer-success) live on holo's MCP endpoint at the founder's company. Stack: monorepo (`apps/web`, `apps/mcp`, `apps/worker`), Postgres + pgvector + Drizzle, Better Auth multi-tenant, ingestion-time allowlist enforcement, hybrid search (RRF), audit log, **9 connectors** (Slack, GitHub, Notion, Grain, Pylon, HubSpot, Linear, Mintlify, Zendesk — spec called for 6), MCP tools `search` / `get_thread` / `get_pr` / `get_doc` / `get_call` / `get_ticket`. See [`CHANGELOG.md`](../CHANGELOG.md) and v0.0 commit history for detail.

### v0.1 — Skills + public release · 🟡 in progress

**Shipped:** `packages/skills` (synth + eval + executor + redactor + golden set), REST/OpenAPI via `@hono/zod-openapi`, static API-token auth, "Connect your agent" panel (Claude / ChatGPT / Gemini / Slack / OpenAPI / Custom MCP), dashboard charts, GitHub Discussions, the v0.1 test plan ([TODOS.md item 1](../TODOS.md)).

**Active work (next up):**

- [x] **CP2 — observability dashboard + read-only replay diff.** Last-100-invocations view, side-by-side query/result diff, per-CTO replay metric. `replay_views` table records each replay open; the observability list-page toolbar surfaces the distinct-viewer count.
- [x] **CP3 — `npx holo init`.** macOS/Linux quickstart, GitHub-only at install, ≤30s TTFUQ (DX D44). Interactive prompts for the three keys and bundled docker-compose template.
- [x] **MCP OAuth on the gateway.** Real OAuth 2.1 + PKCE provider (`@holo/oauth-provider`), `/api/oauth/authorize` + `/token` + `/register`, gateway middleware validating bearer tokens, `oauth_auth_codes` + `oauth_access_tokens` tables — all on main. Per-user OAuth ACL fan-out is tracked separately under v0.2/v0.3.
- [x] **BYO-agent reach demo.** ChatGPT Action + Gemini function call hitting the same instance an MCP client uses. ChatGPT MCP/Action via the `ChatGPT` and `OpenAPI` tabs; Gemini via the new `Gemini` tab — both dispatch to the same gateway base with the same API tokens.

**Release plumbing:**

- [ ] GHCR image auto-published on tag.
- [ ] Show HN draft + demo recording.
- [ ] First 3+ external CTOs onboarded; ≥1 running >2 weeks.
- [ ] Skill-quality kill-switch (3-of-5-usable against golden set; pass → ship skills, fail → ship context-layer-only).

**Moved out of v0.1:** skill marketplace stub (CP1) → v0.3 (skills + marketplace need more love and real users first).

### v0.2 — Self-host polish + free-form skills · 🟡 partial

**Shipped (on `claude/holo-v0.3-*` branches):** real OAuth 2.1 + PKCE provider, per-user Slack OAuth + `user_subjects_cache`, CLI-as-tool registration.

**Still open:**

- [ ] MCP authorization granularity proxy — per-skill `toolAllowlist` enforcement ([TODOS.md item 6](../TODOS.md)).
- [ ] GitHub Actions ingestion mode — `maakle/holo-sync@v1` ([TODOS.md item 7](../TODOS.md)).
- [ ] Free-form unsupervised skill extraction (variant a), gated on broader golden-set coverage.
- [ ] Replay live-execution with per-tool effect classification ([TODOS.md item 5](../TODOS.md)).
- [ ] Windows support for `npx holo init`.
- [ ] Coolify one-click template + other self-hosted PaaS support (Railway is the supported launch path).
- [ ] Managed cloud beta.
- [ ] Audit log surface for self-hosters.
- [ ] `execute_skill` MCP tool.
- [ ] DCR endpoint + consent UI.
- [ ] Webhook-accelerated incremental sync (gated on freshness pain).
- [ ] Productize agent templates ([TODOS.md item 4](../TODOS.md)).

**Moved to v0.3:** per-user OAuth fan-out for non-Slack connectors, refresh tokens, scope enforcement, Slack-subjects TTL UI, `mcp-remote` proxy.

### v0.3 — Skill marketplace + per-user ACL completion · planned

Picked up after v0.1 ships and 3+ external CTOs are using holo.

**Skill marketplace stub (CP1, deferred from v0.1):**

- [ ] `/skills` route — public registry browse, no auth to read.
- [ ] "Publish anonymized" with two-stage redact-then-confirm flow (GitHub OAuth required to publish).
- [ ] MIT contribution license (skill marketplace publishes are CE); takedown email + 5-publishes/day rate limit.
- [ ] Define "skill" = YAML doc + redacted example outputs.

**Per-user OAuth fan-out — non-Slack:**

- [ ] Notion, GitHub, Grain, Pylon each populate `user_subjects_cache`.
- [ ] Per-user fan-out for v0.3 connectors as they land.

**OAuth provider polish:**

- [ ] Refresh tokens (replace 24h plain bearer cycle).
- [ ] Token-level scope enforcement at tool dispatch.
- [ ] Slack-subjects TTL admin UI.
- [ ] `mcp-remote`-style proxy for clients without native OAuth.

---

## Next connections to build

Existing (9): **Slack, GitHub, Notion, Grain, Pylon, HubSpot, Linear, Mintlify, Zendesk.**

Next 15, rough priority order. Pick from the top as users request; skip any whose API can't support incremental sync (same week-1 verification rule as Grain/Pylon).

1. **Google Drive** — Docs/Sheets/Slides; closes the doc gap Notion alone misses.
2. **Google Calendar** — meeting context; pairs with Grain/Fathom.
3. **Gmail** — threads in user-allowlisted labels; high-value, high-risk → label allowlist mandatory.
4. **Confluence** — enterprise wiki for buyers not on Notion.
5. **Jira** — issues/sprints; pairs with Confluence.
6. **Salesforce** — CRM for buyers not on HubSpot.
7. **Intercom** — alternative to Pylon/Zendesk.
8. **Microsoft Teams** — required for enterprise buyers not on Slack.
9. **M365 / SharePoint + OneDrive** — pairs with Teams.
10. **Outlook / Exchange Online** — same shape as Gmail.
11. **GitLab** — code-host parity; reuses GitHub chunking.
12. **Asana** — PM parity for teams not on Linear/Jira.
13. **Sentry** — incident-response error context.
14. **PagerDuty** — pairs with Sentry.
15. **Fathom** — second meeting source after Grain; Fireflies follows on same code-path.

**Implementation checklist (every new connector):**

- [ ] OAuth/API-key at `/api/connectors/<provider>/callback` or `/connect/<provider>`, token encrypted with `HOLO_TOKEN_ENCRYPTION_KEY`.
- [ ] Listed in `SYNC_PROVIDERS` (web + CLI mirror).
- [ ] Cadence in `packages/connectors/src/sync-intervals.ts`.
- [ ] `connector_cursors` + incremental sync; no nightly full re-pulls.
- [ ] Allowlist enforcement at ingestion (channels / repos / spaces / labels).
- [ ] Test in `packages/connectors/test/<provider>.test.ts` (allowlist gating + retrieval roundtrip).
- [ ] Setup guide in `docs/connectors/<provider>.md`.
- [ ] At least one `get_<resource>` MCP tool where the shape isn't obvious from `search`.

---

## Beyond v0.3

Picked from observed user need:

- **Drift detection** — declare goals/OKRs/PRDs, compare against artifacts, flag drift. Year-3; lives in [`VISION.md`](./VISION.md).
- **Long-tail connectors** beyond the 15 above — Fireflies, BambooHR, Greenhouse, Ashby, Stripe, Figma, Discord, Front, Help Scout, Freshdesk, Bitbucket, Datadog, Productboard, Coda, Airtable, GitBook, ReadMe, Loom, Zoom, Otter.ai.
- **Reranker on by default** if dogfooding shows latency is acceptable.
- **Action tools in MCP** — write, not just read.
- **Managed cloud offering** when 3+ paying self-host customers ask.
- **Graph layer** (Apache AGE), **ClickHouse analytics** (>10M event rows), **multi-modal ingestion** (Figma/video/screenshots) — only when justified.

---

## How we'll work

- One week = one milestone slice. Slip = cut scope.
- Every milestone ends with a demo recording (private through v0.0, public from v0.1).
- Issues on the `Holo` GitHub Project, tagged with milestone (`v0.0`/`v0.1`/`v0.2`/`v0.3`) and area (`area:connectors`, `area:mcp`, `area:auth`, `area:retrieval`, `area:skills`, `area:web`, `area:infra`).
- ADRs in `docs/decisions/` for any non-obvious decision.
- No private branches living more than a week.
- **Parallel external validation:** v0.1 public release needs 2+ peer-CTO responders confirming the multi-agent context-duplication pain.
