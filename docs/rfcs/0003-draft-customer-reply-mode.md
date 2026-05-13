# 0003 — RFC: Draft Customer Reply Mode

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** What shape should "draft a customer reply" take — a prompt, a skill, a dedicated chat mode, or an MCP tool?

## Context

A power user on the dogfood team invoked the same pattern 20+ times in two months in raw prose:

> "Customer X said Y. Look at the tickets, the last call, the docs they cite. Draft a reply in a CS tone, ~4 sentences."

Today they're typing the whole instruction every time. The retrieval works; the loop doesn't. Productizing this is the single highest-frequency workflow in the dogfood export.

## What we're solving (and what we're not)

**We are:** turning a recurring multi-step prompt into a first-class flow with structured input, multi-source retrieval, a draft, side-by-side sources, and an accept/edit/iterate loop.

**We are not:** building a reply send-action (no Pylon-write or email-send yet — that's RFC-future), and we are not building per-customer reply-style learning (that's downstream of RFC-0008 quality feedback).

## Proposed shape

A new chat mode `compose-reply` in the web app, backed by a skill template under `packages/skills/templates/compose-reply.yaml` and a thin orchestrator wrapper.

### Input

```
{
  customerMessage: string,            // pasted text or Pylon ticket URL
  customerHint?: string,              // optional — name, HubSpot ID, account_id
  tonePreset: 'cs' | 'ae' | 'support-engineer' | 'pm',
  length: 'one-liner' | 'short' | 'detailed',
  extraGuidance?: string              // optional free-text steer
}
```

`customerHint` resolves via PR #184's `customer_accounts` table (UUID or fuzzy name → `account_id`). Empty hint = the model tries to infer the customer from `customerMessage` and asks for confirmation if ambiguous.

### Flow (per turn)

1. **Resolve the account** — either from hint or by extracting names/domains from the message; falls back to "I'm not sure which customer this is" rather than guessing.
2. **Retrieve** — calls `search` with `accountId` filter set, plus an unscoped pass for product-doc context. The model decides what to fetch (tickets, calls, docs) using the existing tool surface, not a hardcoded recipe.
3. **Draft** — single LLM call, structured output: `{ reply, citations[], confidence, openQuestions[] }`. Tone preset injects a short style block into the system prompt; length preset sets max tokens.
4. **Surface** — chat panel renders the draft on the left, citations + raw excerpts on the right (reusing the citation rendering from PR #188).
5. **Iterate** — user can either edit inline (textarea), tap a tone/length preset to regenerate, or feed steer ("more apologetic", "cite the deeper Grain context"). Each iteration is a new orchestrator turn that carries forward the prior draft + edits as part of the message history.

### Persistence

A new table `reply_drafts(id, organization_id, user_id, account_id, customer_message, latest_draft, status, created_at, updated_at)` so users can come back to a draft. Iterations stored in `reply_draft_revisions(draft_id, revision, prompt, output, accepted_at, ...)`. This is also the substrate RFC-0008 hooks into for the rating loop.

## Open questions

1. **Skill template vs. dedicated orchestrator.** A skill template lives in `packages/skills/templates/` and runs through the standard agent loop. A dedicated orchestrator wraps `runChatAgentLoop` with a fixed system prompt and a narrower tool set. **Recommend:** skill template — keeps the surface uniform and lets users fork it (RFC-0005). Tradeoff: skill templates can't currently force structured output; we'd add `outputSchema` to the skill YAML.
2. **Where does the customer get resolved?** Server-side at orchestrator entry (cheap, but the model can't disambiguate) or model-side via a `resolve_customer` tool call (one extra LLM round-trip, but handles "I think they mean Skello GmbH not Skello SAS"). **Recommend:** model-side, with a server-side fast path when `customerHint` is a UUID.
3. **Tone presets — fixed or org-overridable?** Three or four sensible defaults shipped, plus an org-level override in the YAML so a customer can set their own ("Holo voice"). Defaults are not personalization, they're scaffolding.
4. **UI placement.** Standalone `/compose` route, or a mode toggle inside the existing chat panel? **Recommend:** standalone route — the side-by-side citation panel doesn't fit the chat layout, and a separate URL means users can bookmark / share drafts.

## Tradeoffs to lock down

- **Sources panel: live re-query, or frozen snapshot?** If the user iterates 5 minutes after the first draft and a new Pylon ticket landed, do they see it? **Recommend:** frozen snapshot per draft, with an explicit "refresh sources" button. Predictability beats freshness here — iterating on a moving target is worse than staleness.
- **No-citation drafts: refuse, or warn?** If retrieval returns zero relevant chunks, do we draft anyway with a warning? **Recommend:** draft with a banner ("No customer-specific context found — drafting from general knowledge"). Refusing here would just push the user to ChatGPT.

## Out of scope (initial PR)

- Sending the reply (just produces text + a "copy" button)
- Per-user tone learning
- Multi-customer batch drafting
- Channel-specific reply formats (Pylon vs. email vs. Slack DM)

## Recommendation

Skill template at `packages/skills/templates/compose-reply.yaml` + a `/compose` web route + the two new tables, behind an org-level setting `reply_drafts_enabled` (default true once shipped). Depends on:

- PR #184 (✅ shipped) — account resolution
- PR #188 (✅ shipped) — citations surface
- RFC-0005 — for forking / customizing the skill
- RFC-0008 — for the rating loop on each draft revision

Build order: ship the skill + a minimal `/compose` UI first; layer rating/customization once RFC-0005 and 0008 land.
