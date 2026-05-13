# RFC-0007 — Hallucination Guardrails

**Status:** Accepted (initial scope landing).
**Owner:** chat surface.
**Implementation:** `claude/hallucination-guardrails` branch — see the PR linked from this file.

## Problem

The chat surface currently returns free-form markdown grounded in tool
output. PR #188 added inline `citations[]` so the user can audit where a
fact came from, but the answer itself still has no machine-readable
breakdown of which sentences are grounded vs. inferred vs. guessed.

Two failure modes show up in early customer use:

1. **Quiet hallucination.** The model writes "Acme pays $250k ARR" with
   no citation. The user has no signal that this number was invented; the
   `[1]` citations elsewhere in the answer give the whole reply an air of
   authority.

2. **Status drift.** "The Slack integration is broken" or "Skill labels
   is shipped" — short, declarative product/integration claims that are
   load-bearing for the user's next decision. Same problem: no
   per-statement signal.

## Recommendation

**Contract:**

Every chat answer (when the caller opts in via `requireClaims: true`)
carries a structured `claims[]` envelope alongside the answer text. Each
claim is:

```ts
interface AnswerClaim {
  text: string;                                       // substring of answer
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  citationIndices: number[];                          // 1-based refs into citations[]
  reason?: string;                                    // why low/unverified
}
```

Wire shape is snake_case, matching PR #188:

```ts
interface WireAnswerClaim {
  text: string;
  confidence: 'high' | 'medium' | 'low' | 'unverified';
  citation_indices: number[];
  reason?: string;
}
```

**Emission.** The model calls a local tool `emit_claims` with the final
answer string + the claims array. This is treated as a terminal step by
the orchestrator (similar to a "final answer" tool). The orchestrator
appends a system-prompt suffix when `requireClaims` is true to instruct
the model on the protocol.

**Server-side enforcement (mandatory).** After the model returns:

1. A claim with `confidence: 'high'` and `citationIndices: []` is
   **downgraded** to `medium` with `reason: 'no citation matched'`. The
   model is fallible at the confidence step; one uncited "high" should
   not pass.

2. A claim whose text matches `requiresHardCitation()` and has empty
   citations is **hard-gated** to `unverified` with a reason. The
   orchestrator also appends a "couldn't verify" note to the answer
   text. Hard-gate trumps downgrade — these shapes are exactly where a
   silent `medium` would be most misleading.

The hard-gate classifier is a heuristic (keyword + regex). It covers:

- Quantitative customer claims (ARR / MRR / seat / ticket / currency
  with magnitude suffix).
- Product-status claims ("X is shipped / launched / on the roadmap /
  deprecated", and negations).
- Integration-status claims ("X is broken / offline / failing /
  working / healthy", named-provider variants).

Hand-curated phrase list — not exhaustive. False negatives are
acceptable; false positives ("require a citation for a clearly safe
statement") are tolerable because the worst that happens is the model
provides a citation it already had.

**UI.** The web chat renders:

- Inline confidence chips below the answer:
  - `high` → no chip (default, don't draw the eye to the good case).
  - `medium` → muted "uncertain" pill, surfaces on hover.
  - `low` → amber "low confidence" pill, always visible.
  - `unverified` → red "unverified" pill, always visible.
- A banner above the answer when any claim is `unverified`:
  "N claim(s) couldn't be verified from your data."

Colors use DESIGN.md tokens (`--warning`, `--error`, `--surface-2`) at
the 12%-transparent fill pattern documented in the Badges section. No
new design tokens introduced.

**Stream protocol.** The existing `done` event on `/api/chat` gets an
optional `claims?: WireAnswerClaim[]` field. Older clients ignore
unknown fields, so this is backwards-compatible.

## Out of scope

Explicitly **not** building in this RFC:

- Per-token attribution. (Too fine-grained for the heuristic this surface
  can support today.)
- A model-grader pipeline for offline claim evaluation.
- Confidence calibration training data collection.
- Aggregate confidence dashboards.
- A dedicated claim-classifier model. The hard-gate is heuristic only.
- Migration of historical conversations to attach claims. Claims are
  emitted at runtime; nothing persisted.

## Implementation summary

- `packages/agent-tools/src/claims.ts` — `AnswerClaim`,
  `WireAnswerClaim`, `claimToWire`, and the `emit_claims` tool schema.
- `packages/agent-tools/src/claims-classifier.ts` — `requiresHardCitation`
  and `classifyClaim` (heuristic, regex-based).
- `packages/agent-tools/src/chat-orchestrator.ts` — new `requireClaims`
  option, `CHAT_CLAIMS_SUFFIX` system-prompt addendum, terminal
  `emit_claims` interception, downgrade + hard-gate enforcement,
  `claims?: WireAnswerClaim[]` added to the `'answer'` result.
- `apps/web/src/app/api/chat/route.ts` — opts the web chat into
  `requireClaims: true`, threads `claims` through the `done` stream
  event.
- `apps/web/src/components/chat-panel.tsx` — `UnverifiedBanner` +
  `ClaimChips` components, using DESIGN.md tokens.
- Co-located Vitest coverage in `packages/agent-tools/test/`.

## Open questions (next iteration)

- Persist claims on `chat_messages` so historical conversations can show
  chips. Held back here because the RFC says no migration in v1.
- Allow the customer to mark a connector as "trusted authority" so a
  product-status claim cited to e.g. the GitHub releases connector
  could bypass `unverified` even on a tighter heuristic.
- Surface aggregate counts in the audit dashboard (claims-per-conv,
  hard-gate fire rate) once we have enough volume.
