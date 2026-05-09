# TODOs

Tracked work that isn't in scope for the current milestone but shouldn't be forgotten.

---

## 1. v0.1 test plan is non-optional before public release

**What:** Implement the v0.1 test plan at `~/.gstack/projects/maakle-holo/maakle-main-eng-review-test-plan-20260429-122216.md` before any external CTO is invited to v0.1.

**Why:** v0.0 ships untested by deliberate founder choice (the blast radius is the founder's own company; founder accepts the risk of internal data being seen in agent responses while iterating). v0.1 invites external CTOs onto holo with their own customer data — different blast radius.

**Status (2026-05-09 — see `claude/v01-test-plan` PR):**

| Item | Status | Where |
|---|---|---|
| Allowlist enforcement (CRITICAL) | ✅ covered | `packages/connectors/test/shared/{allowlist,evaluate-allowlist}.test.ts` (DB-backed + pure-function); `packages/connectors/test/{notion,slack,github}.test.ts` allowlist-gating describe blocks |
| Per-connector ingestion + retrieval integration | ✅ covered | All 9 `packages/connectors/test/*.test.ts` (github, slack, notion, grain, pylon, hubspot, linear, mintlify, zendesk); plus `packages/retrieval-core/test/connector-roundtrip.test.ts` for the embed→search round-trip |
| Hybrid search (BM25, vector, RRF fusion) | ✅ covered | `packages/retrieval-core/test/{parity,query-router}.test.ts` |
| `HoloError` format golden-set (5+ scenarios) | ✅ covered | `packages/errors/test/holo-error.scenarios.test.ts` (7 scenarios: missing token x2, OAuth failure, rate limit, search miss, allowlist empty, no active org). ESLint rule `local/no-bare-throw-error: error` already blocks bare throws. |
| Connections-page OAuth E2E | 🟡 **partial / skipped** | `tests/e2e/tests/connections.spec.ts` exists but is `test.skip` because Better Auth verifies session cookies via HMAC and direct DB seeding fails verification. Unblocking needs option (1) call `auth.api.signInEmail` programmatically, (2) drive real OAuth via mocked GitHub, or (3) mock `getSession` at the Next.js handler boundary. |
| "Connect your agent" snapshot tests for config blobs | ⏸ **deferred** | `mcpJsonConfig` / `curlVerify` are private helpers in `apps/web/src/components/connect-agent-panel.tsx`. Either export them (overlaps with the connect-agent-panel split PR) or use RTL/jsdom to render and snapshot. Pick one once the split PR lands. |
| Skill eval harness (≥10 golden entries) | ❌ **blocked** | `packages/skills` is v0.5 per ROADMAP. No skill synthesizer to evaluate yet. |
| Skill marketplace publish (CP1) — redaction golden-set + takedown E2E | ❌ **blocked** | No skill marketplace shipped. |
| Observability dashboard (CP2) — replay diff snapshot + metric correctness | ❌ **blocked** | Replay diff feature not implemented. |
| `npx holo init` (CP3 + DX D44) — clean-container integration test | ❌ **blocked** | No `holo init` command in `packages/cli` yet. |

**Pros:** Catches the allowlist regression that would cause an incident on day 1 of v0.1; per-connector tests catch ingestion drift when source APIs change; skill eval harness prevents silent quality regression on prompt iteration.

**Cons:** Adds 1–1.5 weeks to v0.1 timeline.

**Context:** During /plan-eng-review on 2026-04-29, founder accepted v0.0-untested as a calculated risk for internal-only build. The non-optional gate for v0.1 was logged then. If this TODO is skipped, the v0.1 launch is at meaningful incident risk.

**Depends on / blocked by:** Four remaining items are blocked on features (skill synthesizer, skill marketplace, observability replay, `holo init`) that have not shipped. They become test-able as those features land.

---

## 2. Production database access via CLI-as-tool (revised after CTO transcript review)

**What:** Implement the CLI-as-tool registration pattern (planned v0.2 in ROADMAP). Founder registers a scoped CLI command (e.g., `bq query --max_rows=100 --use_legacy_sql=false`) with read-only credentials limited to specific datasets, and holo exposes it as an MCP tool the agent can call.

**Original framing (rejected):** Build a Postgres / MySQL connector with OAuth, ingestion, chunking, and per-table ACL. ~2 weeks of work, big new attack surface.

**Revised framing (per CTO's working MVP):** Skip the connector entirely. Hand the agent a scoped CLI + a tightly-scoped service account credential. The agent invokes the CLI through holo's MCP proxy. Done.

**Why:** The support-question agent at Kombo today answers queries that require live production data:

- "average applications per job live for customer Talroo"
- "how much overage does MrWork owe Kombo this month"
- "all ATSs Kombo supports including current number of active connections"

holo v0.0 and v0.1 ingest knowledge sources (Slack/GitHub/Notion/Grain/Pylon/HubSpot) but not transactional production data. These queries cannot migrate to holo.

**Pros (build the connector):** Single MCP endpoint covers 100% of agent's queries; no dual-routing; cleaner architecture.

**Cons (build the connector):** Production DB is high-stakes — accidentally exposing it via holo's MCP layer could leak customer data to any agent that calls `search`. Needs careful per-query scoping (read-only role, allowlisted tables, possibly a separate MCP endpoint with its own auth). At least 2 weeks of work done right.

**Pros (accept dual-routing):** No new attack surface; production data stays in the agent's existing fetcher.

**Cons (accept dual-routing):** Inconsistent grounding (some queries hit holo, some don't); harder to instrument; the "shared context layer" pitch is partial.

**Context:** Surfaced during /plan-eng-review on 2026-04-29 from the support-channel queries founder pasted (Konsti's MrWork overages, Kofi's Talroo throughput, etc.). Out of scope for v0.0 and v0.1. Decision and design needed before v0.2.

**Depends on / blocked by:** Decision on per-user OAuth ACL (v0.2) — production DB queries should respect the calling user's permissions, which is upstream of this work.

---

## 3. File / attachment parsing for ad-hoc documents

**What:** Decide whether to support per-message attachment ingestion (PDFs, images) attached to Slack messages, Notion pages, or Pylon tickets — or accept this as permanently out of scope.

**Why:** The support-agent today handles queries like "answer the coverage questions in this attached PDF" (Jesse's Tipalti example). The current agent presumably reads attachments inline at query time. holo's context layer ingests structured records (messages, threads, PRs, pages, calls) but not arbitrary file attachments.

**Pros (build attachment parsing):** Covers more of the agent's real query mix; one less reason for the agent to dual-route.

**Cons (build attachment parsing):** PDF parsing is non-trivial (text extraction, table extraction, OCR for scanned PDFs); files attached to one message are a fundamentally different access pattern (per-message vs. context layer) and may not benefit from being ingested into the global search index; storage costs grow fast.

**Pros (accept out of scope):** Context layer stays focused on knowledge sources; attachment parsing stays the agent's responsibility (where Cursor / Claude already handle it well).

**Cons (accept out of scope):** "Shared context layer for all agents" claim has a documented hole.

**Context:** Surfaced during /plan-eng-review on 2026-04-29 from Jesse's PDF-attachment query in the support channel. Recommended to defer until at least one v0.1 external CTO requests it — otherwise it's a YAGNI build.

**Depends on / blocked by:** Nothing technical. Blocked on user demand signal.

---

## 4. Productize the 3 v0.0 agents as YAML templates (CP4 from /plan-ceo-review)

**What:** Take the support-question, interview-prep, and customer-success agents being built for the founder's team in v0.0 and extract their prompts + tool configurations into YAML templates committed in `packages/agent-templates/`. Documented in the README so a new holo install can `holo use-template support-question-agent` and get a working agent in ~60 seconds.

**Why:** Most teams don't have a custom AI agent today. They want one but don't know where to start. Holo's pitch — "shared context layer for the agents your team is already shipping" — assumes they have agents. Templates give them a starting point. Changes the launch story from "bring your own agents" to "bring your own agents *or pick one of ours*."

**Pros:** Productizes work already being done at the founder's company (low marginal cost — ~3 days). Templates become marketing artifacts ("4 real-world agent patterns we tested on"). Demonstrates holo is a complete solution, not just a context layer.

**Cons:** Templates need ongoing maintenance as holo API evolves. Some teams will customize and fork; that's a support burden. Risk of templates drifting from the founder's actual agents if those evolve internally.

**Context:** Surfaced and decided in /plan-ceo-review on 2026-04-29 (CP4). Founder chose to defer to TODOS rather than add to v0.1 scope. Reasoning: keep v0.1 tight; productize once 3+ external CTOs are using holo and surface concrete demand for templates. Trigger to revisit: when an external CTO asks "do you have a starting template for X?"

**Depends on / blocked by:** v0.1 ships and at least 3 external CTOs are using holo. Don't productize templates until there's evidence external teams want them.

---

## 5. Replay live-execution (deferred from v0.1's CP2)

**What:** v0.1 ships a read-only replay diff (recorded query + result, side-by-side). v0.2 should add live re-execution so users can verify "if I called this MCP tool again right now, what would I get?" — useful for verifying that data drift fixes work.

**Why:** Read-only diff catches "what context did the agent see at time T?" Live re-execution catches "is that context still correct now?" The combination is the full debugging story.

**Pros:** Closes the OS-tomorrow story; debugging UX leaps forward.

**Cons:** Live re-execution of side-effecting MCP tools (like a hypothetical `post_to_slack`) is dangerous. Requires per-tool effect classification (read-only vs side-effecting) and explicit user confirmation before re-running side-effecting tools. Implementation is non-trivial.

**Context:** Surfaced during /plan-ceo-review's spec review on 2026-04-29. v0.1's replay was scoped down to read-only diff specifically to avoid mutating-tool risk. v0.2 is the right home once tool-effect classification is in place.

**Depends on / blocked by:** Tool effect classification (read-only vs side-effecting) at the MCP-tool spec level. Likely a v0.2 architecture decision.

---

## 6. MCP authorization granularity proxy (v0.2)

**What:** holo's MCP layer enforces per-skill `toolAllowlist` (see ARCHITECTURE.md skill data model). Calling agent invokes a tool → holo looks up the active skill → rejects calls outside the allowlist with a structured `HoloError` (per DX D46).

**Why:** Founder's CTO articulated the pain explicitly during the MVP review: *"Pylon MCP has the same method that makes an internal OR external message. We can't decide whether the agent can do one of both or whether he can do both. Cursor doesn't even offer to select tools."* Every adjacent product (Cursor, Claude Desktop, Onyx) assumes "MCP server's whole tool surface is exposed." holo's per-skill allowlist solves a real DX gap that nobody else solves.

**Pros:** Solves a stated pain at the buyer's company today. Differentiates holo from raw MCP servers. Pairs naturally with the v0.1 skill model since `toolAllowlist` is already a field on the skill row.

**Cons:** Requires intercepting every MCP tool call at holo's proxy layer; latency overhead is small but real. Some MCP clients may not pass enough context to identify the active skill — fallback to a default skill or rejection.

**Context:** Surfaced 2026-04-29 from CTO's MVP review. Cross-cuts with the v0.1 skill model work — the data model is in v0.1, but the proxy enforcement lands v0.2.

**Depends on / blocked by:** v0.1 skill model with `trigger` + `toolAllowlist` fields shipped.

---

## 7. GitHub Actions ingestion mode (v0.2)

**What:** Ship `maakle/holo-sync@v1` as a public GitHub Action that wraps holo's ingestion code-path. Teams add a workflow file calling the action on cron; the action authenticates to holo and pushes ingested data through the same code-path the worker process uses.

**Why:** Founder's CTO built the MVP entirely on GitHub Actions cron jobs writing files to a repo. That's a real pattern in the dev-tools ecosystem, especially for OSS teams who already have GitHub Actions but don't want to run another long-lived worker process. Two workflows for holo installs:
- **Worker mode** (current plan): `apps/worker` runs continuously with BullMQ, processes ingestion jobs.
- **GitHub Actions mode** (this TODO): no worker process; GitHub Actions runs the same code on cron.

Both write to the same Postgres tables; both use the same connectors and chunking. Different trigger only.

**Pros:** Reaches the segment of buyers who'd otherwise build the CTO's MVP themselves. No new infrastructure to learn — they already use GitHub Actions. Pairs with `npx holo init` for a fully self-hosted, fully OSS path with zero long-lived processes (ingestion is GHA, server is `docker compose up` only when an agent connects).

**Cons:** Requires the same connector code to work in both worker and GHA contexts. GHA has tighter time limits per job (~6 hours) — large initial syncs may need chunking across multiple workflow runs.

**Context:** Surfaced 2026-04-29 from CTO's MVP review. The CTO's whole architecture is GHA-based; that pattern works for at least one of holo's target buyers.

**Depends on / blocked by:** Worker-mode ingestion shipped in v0.0/v0.1 (the connector code is shared).
