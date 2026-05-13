# 0007 — RFC: Hallucination Guardrails

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** What's the smallest visible primitive set that turns "do not hallucinate" from a brand hope into a brand promise?

## Context

The dogfood team is literally typing *"make sure you do not hallucinate"* into prompts. PR #188 made citations available; this RFC makes *not citing* a visible failure mode rather than a silent one.

Three behaviors we want to surface as UI primitives:

1. **Per-claim confidence** — the model commits to a confidence level for each factual claim about a customer, integration, or quantity.
2. **Citation required, or stated absence.** Every factual claim has at least one citation, or carries an explicit "I couldn't verify this" badge that the user can see.
3. **"I couldn't verify this"** — a first-class response state, not a refusal and not a silent omission.

The wedge here is small but conspicuous. We do not want to drift into general-purpose factuality scoring.

## What we're solving (and what we're not)

**We are:** giving the model a structured way to say "I'm not sure" or "I drew from general knowledge here, not your data" — and giving the UI a way to *show* that prominently.

**We are not:** building a model-grader pipeline that re-checks every answer (cost prohibitive at scale), and not building per-token attribution. The unit is *claim*, not token.

## Proposed shape

### Structured answer envelope

The chat orchestrator's answer return shape gains an optional `claims[]` projection alongside the existing `answer` string and `citations[]` array (from PR #188):

```ts
type AnswerClaim = {
  text: string;              // the substring of `answer` this claim covers
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  citationIndices: number[]; // refs into citations[]; empty when 'unverified'
  reason?: string;           // why low/unverified — short, model-authored
};
```

`claims[]` is opt-in via a new orchestrator option `requireClaims: boolean`. When set, the system prompt instructs the model to emit claims as a parallel structured output (tool call + JSON). When unset, behavior is identical to today.

### UI affordances

- **Inline confidence chips** — high = no chip (default), medium = grey "uncertain" pill on hover, low = amber "low confidence" pill always shown, unverified = red "couldn't verify" pill.
- **"Couldn't verify" callout** — when *any* unverified claim exists, render a banner above the answer: "1 claim couldn't be verified from your data — see highlighted span below."
- **No-citation enforcement** — if a high-confidence claim has no citation, the orchestrator downgrades it to medium with `reason: 'no citation matched'` server-side, before returning. The model can't ship a high-confidence uncited factual claim.

### Required-citation contexts

A handful of contexts require citations as a hard gate (refuse the claim, don't downgrade):

- Any quantitative statement about a customer (ARR, MRR, ticket count, seat count)
- Any product-status statement ("X is shipped", "Y is on the roadmap")
- Any integration-status statement ("Skello's Greenhouse integration is broken")

These are the claim types the dogfood export shows being asked about most, and the ones with the highest cost-of-being-wrong. Detection is heuristic — a server-side classifier (regex + small claim-type model) decides which claims require a hard gate.

## Open questions

1. **Confidence levels — 4 or 3?** Four (high/medium/low/unverified) discriminates "verified from your data" vs. "drew from general knowledge." Three would collapse low+unverified. **Recommend:** four — "unverified" is a different shape of badge than "low confidence" and users care about the distinction.
2. **Who emits `claims[]`?** Model side via a structured-output tool call, or post-hoc via a second small-model pass that segments the answer text and labels each segment? **Recommend:** model-side as a primary tool call. Post-hoc segmentation is brittle and doubles cost. Tradeoff: the model has to be told upfront, costing some answer-time tokens.
3. **Hard-gate enforcement model.** Is a regex/keyword classifier enough to flag "ARR" claims, or do we need a small dedicated classifier? **Recommend:** start with a hand-curated phrase list + a few regexes (numerics adjacent to customer names, status verbs like "shipped/broken/launched" adjacent to product nouns). Upgrade to a classifier only when the false-rate hurts.
4. **What happens when the model refuses to emit `claims[]`?** Some answers are conversational ("yes, that makes sense"). **Recommend:** `claims[]` is optional in the structured output; absence = no factual claims to verify. The UI shows no chips, no banner. Only when `requireClaims` is set *and* `claims[]` is missing despite factual content do we error out.

## Tradeoffs to lock down

- **Cost.** Asking the model to emit `claims[]` adds tokens to every response (maybe 15–25%). **Recommend:** enable by default in the production web chat; let API/MCP consumers opt-out per request. Skill templates that synthesize reports (RFC-0004) always require claims.
- **False humility.** The model will be tempted to label everything "medium" to be safe. **Recommend:** the system prompt rewards "high + cited" as the default and treats medium/low as deliberate decisions. Audit on dogfood before tuning.
- **Latency.** Structured output is one extra round-trip when emitted as a tool call. Live streaming the answer text and patching in claims as a structured trailer minimizes the perceptual cost. The web stream protocol supports this shape already (PR #188 added the coverage tail; claims is parallel).

## Out of scope (initial PR)

- Per-token attribution / highlighting
- A model-grader that re-runs the answer
- Confidence calibration training
- Aggregate confidence dashboards
- Multi-modal confidence (images, audio)

## Recommendation

Ship `claims[]` as an opt-in orchestrator field, enable it by default in the web chat surface, and enforce the no-citation-downgrade rule server-side. Build the four-tier confidence UI per DESIGN.md (chips, banner, hard-gate refusal). Defer the dedicated claim-classifier model; ship with heuristics and revisit when the false-rate is measured against the RFC-0008 feedback dataset.

Depends on:

- PR #188 (✅) — citations array is the substrate
- RFC-0008 — feedback data tells us what "low confidence" claims actually fail in practice
- Orchestrator structured-output capability (LLM client gain; verify the abstraction supports it before scoping)
