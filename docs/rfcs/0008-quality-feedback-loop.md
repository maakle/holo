# 0008 — RFC: Quality Feedback Loop

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** What data, surfaces, and feedback signals do we need to make every answer compound into the eval set — without burdening the user?

## Context

The dogfood team is already labeling. The export is full of *"rate 1/10"*, *"fix if no bueno"*, and free-text corrections delivered as follow-up prompts to the agent itself. They're paying the labeling cost in conversational overhead. Capturing that labor structurally costs us almost nothing and gives us a real eval set in weeks.

This RFC is the smallest possible primitive that lets every answer carry a 👍/👎 + optional correction, and pipes the result into an eval-ready dataset that gates skill changes.

## What we're solving (and what we're not)

**We are:** building the data path. Per-answer ratings, optional corrections, eval seeding, per-skill regression check.

**We are not:** building an RLHF training pipeline, doing online fine-tuning, or reweighting retrieval scores from feedback. Those are downstream.

## Proposed shape

### Data path

Two new tables:

```sql
CREATE TABLE answer_feedback (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL,
  user_id           uuid NOT NULL,
  -- Anchor — every answer has a unique id from the orchestrator trace
  answer_id         uuid NOT NULL,
  skill_slug        text,
  rating            smallint NOT NULL,         -- -1 (👎) | 0 (neutral, no rating) | +1 (👍)
  correction_text   text,                       -- optional free-text
  -- Snapshot — denormalize because answer_id may point at a deleted trace
  question          text NOT NULL,
  answer            text NOT NULL,
  citations_jsonb   jsonb NOT NULL,
  coverage_jsonb    jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eval_entries (
  id                uuid PRIMARY KEY,
  organization_id   uuid NOT NULL,
  source_feedback_id uuid REFERENCES answer_feedback(id),
  skill_slug        text,
  question          text NOT NULL,
  expected          jsonb NOT NULL,             -- { answer_substrings: [], must_cite: [], must_not_say: [] }
  status            text NOT NULL DEFAULT 'pending',  -- pending | active | archived
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

Feedback is captured directly. Eval entries are *promoted* from feedback by a human (the skill owner) — not all feedback is eval-worthy, but every eval entry traces back to a real moment of friction.

### UI

- **Inline rating** — every assistant turn renders a thin rating bar: 👍 / 👎 / "✏️ correct this." Click 👎 or "correct" opens a small textarea. Submission is one HTTP POST; no modal, no full-page reload.
- **Skill owner inbox** — at `/skills/[slug]/feedback`, a list of recent feedback with one-click "Promote to eval" → opens a structured `expected` editor (substrings, must_cite, must_not_say) pre-filled from the correction.
- **Per-skill regression panel** — at `/skills/[slug]`, a tile showing pass-rate against active eval entries. Re-runs nightly via the existing skill-eval harness; surfaces "Eval pass rate dropped 86% → 71% after last edit."

### Pipe into the eval harness

`packages/skills/eval` already exists. Eval entries promoted from feedback become inputs to the same harness. The harness gains:

- A loader that pulls `eval_entries WHERE status='active' AND skill_slug=$slug`
- A grader that checks `answer_substrings`, `must_cite` (chunk ids), `must_not_say` against the orchestrator output
- A reporter that posts pass/fail to the per-skill regression panel

Nothing in the harness contract changes; we just feed it richer entries.

### MCP / REST surface

POST `/v1/feedback` — accepts `{ answer_id, rating, correction_text? }`. Same auth as the rest of the gateway. MCP gets a parallel `submit_feedback` tool so agents calling holo programmatically can record their own quality ratings (useful for the cross-agent eval RFC-future).

## Open questions

1. **Anonymous-by-default or named?** Feedback within an org is named (we want to know which power user is rating); cross-org / marketplace feedback (when it lands) is anonymous. **Recommend:** named in org, with an opt-out at the user level. Aggregate displays anonymize anyway.
2. **What gets denormalized in `answer_feedback`?** Hard schema decision — too little and we can't retrain after the trace expires; too much and the table balloons. **Recommend:** question + answer + citations + coverage (as JSONB) only. No tool-call traces, no model-call traces — those live in the existing orchestrator log and we can join when we need them.
3. **Promotion gating.** Anyone can submit feedback; who can promote to an eval entry? **Recommend:** skill owners + admins. Members' feedback is welcome data; promotion is a deliberate "this is the bar we're holding ourselves to" act.
4. **Eval re-run cadence.** Nightly is the safe default. **Recommend:** nightly, plus on-demand "run now" from the skill detail page, plus on every skill version bump (auto, before promotion). Don't run on every save — that's noisy and expensive.

## Tradeoffs to lock down

- **Capture vs. friction.** A 👎 with no required correction is one click. Many will be unactionable signal-without-substance. **Accept that.** The 👎-count alone is a usable trend metric; corrections sweeten when the user has the energy.
- **Where the eval graders live.** Substring + must-cite is cheap and deterministic; must-not-say catches the "do not hallucinate" failure mode. We can layer LLM-judge graders later, but every grader adds cost on every eval run. **Recommend:** ship the three deterministic graders only.
- **No public visibility.** Feedback is org-private. Marketplace skills publishing (v0.3) gets a redacted aggregate pass-rate, never per-feedback details.

## Out of scope (initial PR)

- LLM-judge eval graders
- Cross-org / public eval datasets
- Auto-promotion (model-suggested eval entries)
- Per-user feedback dashboards
- Retraining / fine-tuning anything

## Recommendation

Ship the two tables, the inline rating UI, the `/v1/feedback` endpoint, the skill owner inbox, and the regression panel that runs against the existing eval harness with the three deterministic graders. Treat promotion-to-eval as a deliberate human action, not an automation.

This RFC is the smallest of the six and the one with the highest compounding value — every answer this team rates becomes a guardrail against future regressions. Build it early.

Depends on:

- Existing `packages/skills/eval` harness
- PR #188 (✅) — `answer_id`, `citations`, `coverage` are the substrate
- RFC-0005 — the skill detail page is where the regression panel lives
- RFC-0007 — `must_cite` graders share the citation-required primitive
