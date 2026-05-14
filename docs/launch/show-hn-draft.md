# Show HN draft

Working draft of the Show HN post for the v0.1.0 launch. Tweak the numbers and links right before posting; everything below should be true on the day it ships.

**Pre-flight checklist (before posting):**

- [ ] v0.1.0 tag cut and pushed.
- [ ] GHCR images for `holo-web`, `holo-gateway`, `holo-worker` published under `ghcr.io/maakle/`.
- [ ] `npx @holo/cli@0.3.0 init` works first-try in an empty directory on macOS + Linux.
- [ ] At least 2 external CTOs have run holo against their own data for >2 weeks (per the v0.1 wedge-validation gate). Ideally one quotable testimonial.
- [ ] Demo recording (≤3 min) uploaded to YouTube unlisted; URL substituted into the body.
- [ ] GitHub Discussions are open and the maintainer has time to triage daily for the first week.
- [ ] Skill-quality kill-switch decision made: the body claims "labeled-template skills" only if the 3-of-5-usable golden-set check passed.

---

## Title (≤80 chars, no marketing words)

```
Show HN: Holo – Self-hosted shared context layer for AI agents (MCP + REST)
```

Alternates if the above feels off:

- `Show HN: Holo – One MCP endpoint for every agent your team builds`
- `Show HN: Holo – Stop re-implementing context fetchers per AI agent`

---

## Body (the OP comment)

> Hi HN — I'm Mathias. For the last ten months I've been Head of Engineering at a 60-person YC dev-tools company, and I kept watching us implement the same context fetcher three times: once for our Slack-triggered support-question agent, once for an interview-prep agent, once for a customer-success draft-reply agent. Each one had its own bespoke retriever over Slack threads, GitHub PRs, Notion pages, Grain calls, Pylon tickets, HubSpot deals. They drifted. They had different ACL stories. None of them could actually answer "what was the resolution on the EGYM ticket Mark closed last week" without a separate fetch.
>
> Holo is the tier I wanted. Connect Slack / GitHub / Notion / Grain / Pylon / HubSpot / Linear / Mintlify / Zendesk once. Holo ingests with cursor-based incremental sync (no nightly full re-pulls), chunks per-source-type, embeds, and indexes them in a single Postgres + pgvector + tsvector store. Hybrid retrieval (RRF fusion) over a single ACL-aware index. Then a tiny MCP tool surface (`search` for fuzzy queries, `bash` for `ls` / `cat` / `grep -r` over a virtual filesystem of every synced artifact) and a parallel REST/OpenAPI endpoint serve every agent on the team — Claude, Cursor, ChatGPT, Gemini, your own. Same chunks, same ACL, same audit log.
>
> Three things I think are different:
>
> **1. Multi-agent first.** The point isn't to be a chatbot. The point is that the agents your team is already shipping stop maintaining their own retrievers. We migrated three internal agents off bespoke fetchers onto holo before this release; they all see the same context now.
>
> **2. Procedures, not just unified search.** Onyx, Dust, PipesHub already do unified search well. Holo also extracts *labeled procedures* from your team's actual artifacts — "this thread is a refund-handling procedure," "this PR is a security-review procedure" — and exposes them as callable skills in the same MCP surface as search. There's a small eval harness so prompt iteration on synthesis doesn't silently regress.
>
> **3. Governance is real.** Ingestion-time allowlists (which channels / repos / spaces actually enter holo) are mandatory and enforced in the connector spec, not bolted on. Per-user OAuth ACL fan-out for Slack is shipped — agents see only the data the calling user can. Per-skill `toolAllowlist` enforcement is the next slice. Read-only replay diff lets you see exactly what context any past agent invocation used.
>
> **Self-host on day one.** If `docker compose up` doesn't work, it doesn't ship. Community Edition is MIT — keep it, fork it, ship a product on top of it. An optional Enterprise Edition (SSO, RBAC, query history, whitelabeling, custom-code hooks) lives under `**/ee/**` for teams that need it. There's no managed cloud yet — that lives behind v0.2 demand.
>
> **Quickstart:**
>
> ```
> npx @holo/cli@latest init   # ~30 seconds to first MCP search
> ```
>
> The init flow scaffolds `.env` with safe defaults, drops a docker-compose.yml that pulls pre-built images from GHCR, and prompts for one Anthropic key + GitHub OAuth credentials.
>
> **What I want from this post:**
>
> - If you've built an internal AI agent at your company, I'd love to hear how you're handling the retrieval / ACL story. Especially the dual-routing pain (some queries to your bespoke fetcher, some to a unified search) — that's where holo started.
> - If you self-host things and want to try a fresh project, the install path above is the only one. Bug reports go to GitHub Discussions; I'm triaging daily for the first week.
> - If your company runs on Microsoft / Atlassian / Salesforce instead of the 9 sources we ship, those are the next 15 connectors on the roadmap (Confluence + Jira are the most-asked).
>
> Repo: https://github.com/maakle/holo
> Docs: https://github.com/maakle/holo#readme
> Roadmap: https://github.com/maakle/holo/blob/main/docs/ROADMAP.md
> Demo (3 min): `<INSERT YOUTUBE UNLISTED LINK>`
>
> Happy to answer architecture questions — pgvector vs Qdrant, why Postgres-only hybrid, how RRF fusion is tuned, how the per-skill toolAllowlist proxy is designed, why we picked Anthropic Skill format for procedures, anything.

---

## Demo recording outline (3 min)

Target: under 180 seconds, no narration audio, just on-screen captions and clean keystrokes.

1. **0:00–0:20 — `npx @holo/cli@latest init`** in an empty directory. Show the prompts: Anthropic key, GitHub OAuth. Show the generated `.env` and `docker-compose.yml`.
2. **0:20–0:40 — `docker compose up -d`** + open `http://localhost:3000`. Sign in with GitHub. Connect Slack and one GitHub repo on the Connections page.
3. **0:40–1:30 — Watch a sync land.** Connections page shows the first sync running, then "✓ N documents." Switch to the dashboard charts (sync throughput + agent invocations) so they're populated.
4. **1:30–2:10 — Wire up an agent.** Open the "Connect your agent" page, copy the Claude Desktop config blob, paste it into Claude Desktop. Run `search` from Claude Desktop — return chunks from the just-indexed Slack channel.
5. **2:10–2:40 — Replay diff.** In the holo dashboard, open the Observability tab. Click the invocation that just happened. Side-by-side input/output view.
6. **2:40–3:00 — Hand-wave at the next surfaces.** Quick cuts: ChatGPT MCP tab, Gemini setup tab (Python snippet), OpenAPI tab (curl).

No voiceover. End frame: repo URL + GitHub Discussions URL.

---

## Anticipated comment threads + my answers

**"Why not Onyx / Dust / PipesHub?"**
> Unified search alone is a commodity by 2026. Holo's wedge is multi-agent — the layer your *agents* plug into, not the chatbot you give your team. Plus procedures (labeled-template skills) and governance (ingestion allowlists, per-skill tool allowlists, read-only replay) that aren't in the unified-search products today.

**"Why Postgres + pgvector instead of Qdrant / Pinecone / Weaviate?"**
> A single SQL CTE that fuses pgvector cosine and tsvector BM25-ish ranking with RRF outperformed our hand-tuned hybrid in two-source benchmarks (Slack threads + GitHub PRs) by p95 retrieval latency *and* MRR. Postgres is one piece of infra to operate vs two. We can move parts to Qdrant later if we need to; today we don't. ADR: `docs/decisions/0002-postgres-only-hybrid-search.md` (link).

**"How do you handle prompt-injection in retrieved Slack messages?"**
> Today: ingestion-time allowlists are the v0.0/v0.1 defense — `#exec`, `#hiring`, `#legal` never enter holo at all, so an attacker who posts a malicious Slack message can only attack the data scope the agent already had access to. Per-user OAuth fan-out (Slack-only today, the rest in v0.3) tightens this further. v0.2 adds per-skill `toolAllowlist` so a `handle_pagerduty_incident` skill literally cannot call `post_to_slack` even if the model is convinced to.

**"Why MIT + a separate Enterprise Edition?"**
> The core (connectors, search, MCP gateway, audit log, skills) is MIT — same model as Onyx — because that's the part of the stack the OSS community legitimately needs to fork, ship on, and run forever without us. The EE surfaces (SSO, RBAC, query history, whitelabeling, custom-code policy hooks) are the parts companies pay for and the parts that fund the work. The split is by file path: anything outside `**/ee/**` is MIT and never moves. If you want to wrap holo (CE) in a commercial offering, do it — that's what MIT is for. If you want EE in production, talk to me.

**"How is this different from `@anthropic-ai/skills` packaging?"**
> Skills *format* is the same — Anthropic's frontmatter + procedure + example tools. Holo just lives one tier down: it's the place every agent fetches context *into* the skills format from, plus the surface where you (eventually) browse and import community skills. Onyx-of-procedures, not a competitor to Anthropic's spec.

**"You shipped this fast. Are you sure about all the assumptions?"**
> No, that's why v0.1 doesn't go public until 2+ external CTOs confirm the multi-agent context-duplication pain over their own week-long usage. The roadmap reframe in 2026-04 (`docs/decisions/0004-...`) was an explicit reaction to "we don't actually know if this matters outside my own company yet." Cold-DM responders gating Show HN is the test.

---

## Don't-post-without checklist

- [ ] Title ≤80 chars, no marketing adjectives.
- [ ] Body opens with "Hi HN — I'm \<name\>." Not "Hey everyone."
- [ ] No emoji.
- [ ] Demo link is public (unlisted YouTube counts).
- [ ] First paragraph names a specific, concrete pain.
- [ ] Repo README's quickstart works first-try on a fresh macOS install — re-verify the morning of posting.
- [ ] GitHub Discussions are open and have visible categories.
- [ ] Maintainer is at a keyboard for the next ~6 hours after posting.
- [ ] Issue tracker is empty or close to it (no `Q4 P0 BUG` flags).
