# RFC-0008: Quality Feedback Loop

**Status:** Implemented (initial cut)
**Owner:** holo core
**Last updated:** 2026-05-13

## Problem

Agent answers degrade silently. When a user notices a wrong or missing
answer, that signal evaporates as soon as the chat panel scrolls. Skill
owners have no way to lock the corrected behavior in against future
regressions.

## Recommendation

Three loosely-coupled surfaces sharing two tables and one harness:

1. **Per-answer rating** (`👍` / `👎` / inline correction) under every
   assistant turn in the chat panel. Submit POSTs `/v1/feedback`.
2. **Promotion** of a feedback row into an `eval_entries` record with a
   structured `expected` payload (substrings, must-cite chunk ids,
   must-not-say strings). Skill owner / admin only.
3. **Regression panel** on the skill detail page that surfaces the
   latest pass-rate from a nightly run of the harness against
   `eval_entries`. Drop-warning if the pass-rate falls > 10pp in 24h.

The harness has three deterministic graders:
- `answerSubstringGrader` — every entry in `expected.answer_substrings`
  must appear in the agent's answer.
- `mustCiteGrader` — every chunk_id in `expected.must_cite` must appear
  in the answer's citations.
- `mustNotSayGrader` — every string in `expected.must_not_say` must NOT
  appear in the answer.

A skill passes when every active eval entry passes every grader.

## Data path

```
chat panel ──▶ POST /api/feedback ──▶ answer_feedback (denormalized)
                                       │
                              owner: "Promote" with structured expected
                                       │
                                       ▼
                            eval_entries (status='active')
                                       │
                       nightly cron (BullMQ "skill-eval")
                                       │
                                       ▼
                            skill_eval_runs (pass_rate roll-up)
                                       │
                                       ▼
                        regression panel on /skills/[slug]
```

## Schema

See migration `packages/db/migrations/0043_answer_feedback.sql`.

Three tables: `answer_feedback`, `eval_entries`, `skill_eval_runs`.
Uniqueness on `answer_feedback (answer_id, user_id)` — re-rating a turn
upserts; the chat panel sending two requests for the same turn does
not double-count.

## API surface

- `POST /v1/feedback` (gateway) — Bearer auth. Mirror at
  `POST /api/feedback` (web, session cookie).
- `POST /api/skills/[slug]/feedback/[id]/promote` (web, session) — owner /
  admin only. Inserts an `eval_entries` row with `status='active'`.
- `POST /api/skills/[slug]/eval/run` (web, session) — owner / admin only.
  On-demand "run now" complement to the nightly cron.
- MCP `submit_feedback` tool — server-side mirror for sub-agent use.

## Out of scope (binding)

- LLM-judge graders.
- Cross-org / public eval datasets.
- Auto-promotion (model-suggested eval entries).
- Per-user feedback dashboards.
- Retraining / fine-tuning of the underlying model.

## Implementation pointers

- Orchestrator change: `packages/agent-tools/src/chat-orchestrator.ts`
  mints a `crypto.randomUUID()` at the top of `runChatAgentLoop` and
  surfaces it as `answerId` on the answer result. Wire is snake_case
  (`answer_id`) so the REST and stream events stay consistent.
- Harness: `packages/skills/src/eval-harness/`.
- Cron: `apps/worker/src/queues/skill-eval.ts` (BullMQ repeatable, 24h).
- UI: `apps/web/src/components/chat-panel.tsx` (rating bar);
  `apps/web/src/app/(app)/skills/[slug]/page.tsx` (regression panel);
  `apps/web/src/app/(app)/skills/[slug]/feedback/page.tsx` (inbox).
