# TODOs

Tracked work that isn't in scope for the current milestone but shouldn't be forgotten.

---

## 1. v0.1 test plan is non-optional before public release

**What:** Implement the v0.1 test plan at `~/.gstack/projects/maakle-memex/maakle-main-eng-review-test-plan-20260429-122216.md` before any external CTO is invited to v0.1.

**Why:** v0.0 ships untested by deliberate founder choice (the blast radius is the founder's own company; founder accepts the risk of internal data being seen in agent responses while iterating). v0.1 invites external CTOs onto memex with their own customer data — different blast radius. The minimum-viable test plan covers:

- Allowlist enforcement (CRITICAL — silent allowlist drift would leak data)
- Per-connector ingestion + retrieval integration tests
- Hybrid search behavior (BM25, vector, RRF fusion)
- One Connections-page OAuth E2E
- Skill eval harness with ≥10 golden-set entries (for v0.1 skill synthesis)
- **Skill marketplace publish (CP1):** redaction-pass golden-set tests with 10 hand-labeled PII examples to verify LLM-redaction works; takedown flow E2E
- **Observability dashboard (CP2):** snapshot test on the replay diff rendering; metric correctness for replay-views-per-CTO
- **`npx memex init` (CP3 + DX D44):** integration test on a clean Linux container — full bootstrap completes + first MCP `search` query succeeds in ≤ 30 seconds (GitHub-only quickstart)
- **`MemexError` format (DX D46):** golden-set tests for 5+ error scenarios (missing token, OAuth failure, ingestion fail, search miss, rate limit). Verify each error has `code`, `problem`, `cause`, `fix`, `docs_url` populated. ESLint rule blocks bare `throw new Error()`.
- **"Connect your agent" page (DX D45):** snapshot tests for each generated config blob (Cursor, Claude Desktop, Cline, curl, Python, TypeScript). Verify token substitution and copy-button works.
- **TTHW telemetry (DX D48):** end-to-end test: install → first search → metric emitted to local endpoint with anonymous UUID + duration. Privacy test: verify no data content in payload.

**Pros:** Catches the allowlist regression that would cause an incident on day 1 of v0.1; per-connector tests catch ingestion drift when source APIs change; skill eval harness prevents silent quality regression on prompt iteration.

**Cons:** Adds 1–1.5 weeks to v0.1 timeline.

**Context:** During /plan-eng-review on 2026-04-29, founder accepted v0.0-untested as a calculated risk for internal-only build. The non-optional gate for v0.1 was logged then. If this TODO is skipped, the v0.1 launch is at meaningful incident risk.

**Depends on / blocked by:** Nothing — implementable in parallel with v0.1 feature work.

---

## 2. Production database connector for support-agent analytics queries

**What:** Decide whether to add a production-DB connector (Postgres / MySQL / whatever the production stack uses) to memex, or accept that the support-agent dual-routes (memex for ingested sources, direct DB for analytics).

**Why:** The support-question agent at Kombo today answers queries that require live production data:

- "average applications per job live for customer Talroo"
- "how much overage does MrWork owe Kombo this month"
- "all ATSs Kombo supports including current number of active connections"

memex v0.0 and v0.1 ingest knowledge sources (Slack/GitHub/Notion/Grain/Pylon/HubSpot) but not transactional production data. These queries cannot migrate to memex.

**Pros (build the connector):** Single MCP endpoint covers 100% of agent's queries; no dual-routing; cleaner architecture.

**Cons (build the connector):** Production DB is high-stakes — accidentally exposing it via memex's MCP layer could leak customer data to any agent that calls `search`. Needs careful per-query scoping (read-only role, allowlisted tables, possibly a separate MCP endpoint with its own auth). At least 2 weeks of work done right.

**Pros (accept dual-routing):** No new attack surface; production data stays in the agent's existing fetcher.

**Cons (accept dual-routing):** Inconsistent grounding (some queries hit memex, some don't); harder to instrument; the "shared context layer" pitch is partial.

**Context:** Surfaced during /plan-eng-review on 2026-04-29 from the support-channel queries founder pasted (Konsti's MrWork overages, Kofi's Talroo throughput, etc.). Out of scope for v0.0 and v0.1. Decision and design needed before v0.2.

**Depends on / blocked by:** Decision on per-user OAuth ACL (v0.2) — production DB queries should respect the calling user's permissions, which is upstream of this work.

---

## 3. File / attachment parsing for ad-hoc documents

**What:** Decide whether to support per-message attachment ingestion (PDFs, images) attached to Slack messages, Notion pages, or Pylon tickets — or accept this as permanently out of scope.

**Why:** The support-agent today handles queries like "answer the coverage questions in this attached PDF" (Jesse's Tipalti example). The current agent presumably reads attachments inline at query time. memex's substrate ingests structured records (messages, threads, PRs, pages, calls) but not arbitrary file attachments.

**Pros (build attachment parsing):** Covers more of the agent's real query mix; one less reason for the agent to dual-route.

**Cons (build attachment parsing):** PDF parsing is non-trivial (text extraction, table extraction, OCR for scanned PDFs); files attached to one message are a fundamentally different access pattern (per-message vs. substrate) and may not benefit from being ingested into the global search index; storage costs grow fast.

**Pros (accept out of scope):** Substrate stays focused on knowledge sources; attachment parsing stays the agent's responsibility (where Cursor / Claude already handle it well).

**Cons (accept out of scope):** "Shared context layer for all agents" claim has a documented hole.

**Context:** Surfaced during /plan-eng-review on 2026-04-29 from Jesse's PDF-attachment query in the support channel. Recommended to defer until at least one v0.1 external CTO requests it — otherwise it's a YAGNI build.

**Depends on / blocked by:** Nothing technical. Blocked on user demand signal.

---

## 4. Productize the 3 v0.0 agents as YAML templates (CP4 from /plan-ceo-review)

**What:** Take the support-question, interview-prep, and customer-success agents being built for the founder's team in v0.0 and extract their prompts + tool configurations into YAML templates committed in `packages/agent-templates/`. Documented in the README so a new memex install can `memex use-template support-question-agent` and get a working agent in ~60 seconds.

**Why:** Most teams don't have a custom AI agent today. They want one but don't know where to start. Memex's pitch — "shared context layer for the agents your team is already shipping" — assumes they have agents. Templates give them a starting point. Changes the launch story from "bring your own agents" to "bring your own agents *or pick one of ours*."

**Pros:** Productizes work already being done at the founder's company (low marginal cost — ~3 days). Templates become marketing artifacts ("4 real-world agent patterns we tested on"). Demonstrates memex is a complete solution, not just a substrate.

**Cons:** Templates need ongoing maintenance as memex API evolves. Some teams will customize and fork; that's a support burden. Risk of templates drifting from the founder's actual agents if those evolve internally.

**Context:** Surfaced and decided in /plan-ceo-review on 2026-04-29 (CP4). Founder chose to defer to TODOS rather than add to v0.1 scope. Reasoning: keep v0.1 tight; productize once 3+ external CTOs are using memex and surface concrete demand for templates. Trigger to revisit: when an external CTO asks "do you have a starting template for X?"

**Depends on / blocked by:** v0.1 ships and at least 3 external CTOs are using memex. Don't productize templates until there's evidence external teams want them.

---

## 5. Replay live-execution (deferred from v0.1's CP2)

**What:** v0.1 ships a read-only replay diff (recorded query + result, side-by-side). v0.2 should add live re-execution so users can verify "if I called this MCP tool again right now, what would I get?" — useful for verifying that data drift fixes work.

**Why:** Read-only diff catches "what context did the agent see at time T?" Live re-execution catches "is that context still correct now?" The combination is the full debugging story.

**Pros:** Closes the OS-tomorrow story; debugging UX leaps forward.

**Cons:** Live re-execution of side-effecting MCP tools (like a hypothetical `post_to_slack`) is dangerous. Requires per-tool effect classification (read-only vs side-effecting) and explicit user confirmation before re-running side-effecting tools. Implementation is non-trivial.

**Context:** Surfaced during /plan-ceo-review's spec review on 2026-04-29. v0.1's replay was scoped down to read-only diff specifically to avoid mutating-tool risk. v0.2 is the right home once tool-effect classification is in place.

**Depends on / blocked by:** Tool effect classification (read-only vs side-effecting) at the MCP-tool spec level. Likely a v0.2 architecture decision.
