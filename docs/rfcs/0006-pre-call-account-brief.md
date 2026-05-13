# 0006 — RFC: Pre-Call Account Brief

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** Is the pre-call brief a skill, a dedicated `/brief/<account>` artifact, a scheduled job, or all three?

## Context

The dogfood export shows four near-identical asks:

- "Is Swile ready for upsell?"
- "Give me everything on BetterWorks"
- "Context on atwork for a follow-up"
- "Brief me on Skello for the renewal call Friday"

The team is hand-typing this every time, in slightly different words. There's a stable target output: who they are, what they pay, what's broken right now, what they last said on a call, what they've asked for, what their integrations look like, who owns the relationship. The pattern is so consistent that productizing it can be a one-click flow.

## What we're solving (and what we're not)

**We are:** turning "tell me about Customer X with context Y" into a structured artifact with sections, citations, freshness indicators, and a calendar-aware "for what" framing.

**We are not:** building a CRM. The brief is read-only synthesis from the connectors we already have; it does not edit HubSpot fields or take notes.

## Proposed shape

### Output

A new artifact at `/brief/<account-id>?context=<renewal|upsell|check-in|objection|first-meeting>`. The page renders five sections, all citation-anchored:

1. **At a glance** — display name, tier, ARR, owner, account age, last contact date.
2. **Open and recent issues** — last N Pylon tickets with status + age, plus any open bugs in linked products.
3. **Last conversation** — most recent Grain call summary + key quotes, top 3 takeaways.
4. **What they've asked for** — open product asks across tickets + calls + Notion notes, grouped by theme.
5. **Context for `<contextual purpose>`** — synthesis section that adapts to the `?context=` param. Renewal = contract terms + churn signals; upsell = expansion hints + buying-committee changes; check-in = vibes + recent friction; objection = the named objection's prior history.

Every claim is cited; sections with no signal show "No signal in the last 30 days" rather than omitting.

### How it's built

Three pieces, each independently shippable:

1. **An MCP tool `get_account_brief(account_id, context)`** that does the multi-source pull and structured synthesis. Returns the same JSON shape the UI renders.
2. **A skill template `pre-call-brief`** that wraps `get_account_brief` so users can invoke it from chat: *"Brief me on Skello for the renewal call Friday"* → skill resolves `account_id`, infers `context=renewal`, calls the tool, renders the artifact inline.
3. **A web route `/brief/<account-id>`** that calls `get_account_brief` directly (no chat) and renders the page. Linkable, bookmarkable, calendar-pasteable.

The three share one synthesis path. The tool *is* the engine; the skill and the route are presentations.

### Freshness

Briefs are *cached per (account_id, context, day)* with a "regenerate" button. Cache TTL = 24h. The UI shows the generated-at timestamp and per-section "freshness chips" pulling from each connector's last-sync time (already in `connector_cursors`).

### Calendar (deferred but design for it)

The eventual win is "tomorrow's meetings auto-generate briefs and DM you at 9am." That's RFC-future. This RFC ships the artifact and tool such that a calendar trigger could call the same path without retrofitting.

## Open questions

1. **Account resolution.** Same problem as RFC-0003. **Recommend:** identical resolution path — UUID fast path, fuzzy-name model path. Share the resolver implementation.
2. **`context=` enumeration.** Five contexts shipped (`renewal`, `upsell`, `check-in`, `objection`, `first-meeting`), or free-text? **Recommend:** five named contexts as the URL params, plus an optional `?customContext=...` free-text override that's appended to the synthesis prompt. Named contexts get section presets; custom context inherits the `check-in` preset.
3. **Brief format — markdown card or structured JSON-to-component?** **Recommend:** structured JSON, rendered by typed React components per section. The same JSON powers calendar DMs, Slack posts, and Notion export later.
4. **Tier / ARR display when those fields are missing.** A lot of accounts don't have HubSpot tier/ARR yet. **Recommend:** show "—" with a hover ("Not synced from HubSpot — connect or update the record"). Don't pretend a value exists.

## Tradeoffs to lock down

- **One big synthesis call or per-section calls?** Per-section is bounded, easier to cite, parallelizable; one big call is cheaper and gives cross-section coherence. **Recommend:** per-section calls, with a final pass that writes a 1–2 sentence "what's new since last brief" header by diffing against the previous cached brief.
- **PII / data-handling.** Briefs concentrate the most sensitive customer info we hold. They must respect the same ACL filters as `search`. Do not bypass `userSubjects` for "convenience." Already handled by going through `searchWithCoverage`, but call it out in the implementation PR.
- **Latency.** A first-time brief that fans out to 5 connectors with 8 retrievals will take 8–15s. **Recommend:** progressive render — stream sections as they complete; show skeletons for sections still pending.

## Out of scope (initial PR)

- Calendar / iCal integration and scheduled briefs
- DM-the-brief (Slack)
- Export to Notion (use Cmd+A → copy for v1; structured export lands with RFC-0004's Notion path)
- Editing a brief
- Cross-account briefs ("brief me on all T0 accounts")

## Recommendation

Ship `get_account_brief` (MCP tool) + `/brief/<account-id>` (web route) + `pre-call-brief` (skill template) as a single PR. Use the structured per-section synthesis path. Cache for 24h with explicit regenerate. Plan the data path such that a future calendar trigger can call `get_account_brief` directly without refactoring.

Depends on:

- PR #184 (✅) — customer entity, ARR/tier/owner metadata
- PR #188 (✅) — citation surface
- RFC-0007 — freshness chips and "no signal" states should follow the hallucination-guardrails primitives
- RFC-0003 — share the account-resolution helper
