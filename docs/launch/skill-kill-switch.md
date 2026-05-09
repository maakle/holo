# Skill quality kill-switch — v0.1.0

The v0.1 roadmap requires a binary kill-switch decision before the v0.1.0 tag is cut: **do at least 3 of 5 freshly synthesized skills pass the founder's "would I let an agent invoke this?" test, or not?**

- **Pass** → ship v0.1.0 with the skill surface enabled.
- **Fail** → ship v0.1.0 as a context-layer-only release. Do *not* delay the public release; defer skills to v0.2.

This file is the recorded artifact of that decision. It must be filled in and committed *before* the `v0.1.0` tag is pushed.

---

## Step 1 — Run the automated half

```
pnpm --filter @holo/skills exec tsx scripts/kill-switch.ts
```

This runs the golden-set structure check and the identity / noise / near-duplicate ROUGE-L baselines. Exit 0 = automated regression checks passed; founder still owes the binary verdict below. Exit 1 = stop here, diagnose first.

Record the result:

- [ ] Automated half exited 0 on commit `<sha>` at `<date>`.

---

## Step 2 — Synthesize 5 skills against real founder-team data

Pick 5 procedures that are actually being run at the founder's company today. Suggested set (substitute any with team-current ones):

1. `handle-refund-request` (from Pylon tickets + Slack threads)
2. `escalate-critical-bug` (from Slack `#engineering` + GitHub issues)
3. `pr-security-review` (from GitHub PR review history)
4. `triage-support-ticket` (from Pylon + Linear)
5. `handle-churn-risk` (from Grain calls + HubSpot deals)

For each, label 5–10 example artifacts via the dashboard and run `synthesizeSkill`. Save the raw output into the matching row below.

| # | Skill slug | Output path / link |
|---|---|---|
| 1 | `<slug>` | `<path or gist>` |
| 2 | `<slug>` | `<path or gist>` |
| 3 | `<slug>` | `<path or gist>` |
| 4 | `<slug>` | `<path or gist>` |
| 5 | `<slug>` | `<path or gist>` |

---

## Step 3 — The binary verdict

For each of the 5, the founder reads the synthesized skill and answers exactly one question: **"would I let an agent invoke this skill against production data without a human review step?"**

Yes = ✅. No = ❌. Half-credit is not allowed; if you'd want to edit one or two steps first, that's a No.

| # | Skill slug | Verdict | Note (one line) |
|---|---|---|---|
| 1 | `<slug>` |  |  |
| 2 | `<slug>` |  |  |
| 3 | `<slug>` |  |  |
| 4 | `<slug>` |  |  |
| 5 | `<slug>` |  |  |

**Tally:** ✅ × `<n>` of 5

---

## Step 4 — Decision

- [ ] **PASS (≥ 3 of 5 ✅)** → v0.1.0 ships with the skill surface enabled. `list_skills` and `get_skill` MCP tools are advertised in the README and the Show HN draft.
- [ ] **FAIL (≤ 2 of 5 ✅)** → v0.1.0 ships as context-layer-only. The skill surface stays in `packages/skills` but is gated off the public docs and the Show HN draft is rewritten to drop the "procedures" claim. Re-run this kill-switch in v0.2 once the synthesis prompt or the eval harness has improved.

**Decided by:** `<founder name>`
**Decided on:** `<date>`
**Decision commit:** `<sha>`
**v0.1.0 tag:** `<sha>` (must be after the decision commit)

---

## Why this is binary, not graded

Earlier drafts of this gate scored skills on a 1–5 usefulness scale and averaged. We dropped that on `2026-04-29` /plan-eng-review feedback: averaged scores let one outstanding skill mask three borderline ones, and the question we actually care about is "would I trust an agent to run this," which has only two answers. The binary 3-of-5 form forces the same decision the founder would make at runtime.

If the verdict is FAIL, do not iterate the synthesis prompt and re-run inside the v0.1 timeline. Ship v0.1 without skills, gather more golden data through real usage, return to the gate in v0.2. The principle is "don't delay the public release" — the wedge survives a context-layer-only v0.1; it does not survive a four-week skill-tuning slip with no users.
