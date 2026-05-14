# RFCs

This directory holds **pre-decision design notes**. Each RFC proposes a shape for a piece of holo we're about to build and surfaces the choices we need to lock down *before* writing code.

RFCs ≠ ADRs:

- **RFC** (`docs/rfcs/`) — "here's a proposal; here are the open questions; here are the tradeoffs." Status: `Draft`, `Under review`, `Accepted` (→ link to ADR), `Rejected`, `Superseded`.
- **ADR** (`docs/decisions/`) — "we decided X; here's the consequence." One-way door; immutable once accepted.

Workflow:

1. Open an RFC PR with a draft. Keep it under ~250 lines — if it sprawls, split it.
2. Discuss in the PR. Update the doc in-place rather than replying in comments.
3. When a shape is settled, mark status `Accepted` and (if the decision is consequential) cut an ADR that links back to the RFC.
4. Build. The RFC stays in the tree as the artifact of the conversation; the ADR is the artifact of the call.

Numbering tracks the original "PRs 3–8" sequencing from the product-direction review on 2026-05-13 (PRs 1 and 2 shipped as `feat(customer-accounts)` and `feat(citations)`; PRs 3–8 are these RFCs).

| # | Title | Status |
|---|---|---|
| 0003 | Draft Customer Reply Mode | Draft |
| 0004 | Customer-Evidence Reports ("Talent Pool" report) | Draft |
| 0005 | Self-Serve Skills | Draft |
| 0006 | Pre-Call Account Brief | Draft |
| 0007 | Hallucination Guardrails | Draft |
| 0008 | Quality Feedback Loop | Draft |
| 0009 | Virtual filesystem over the context layer | Draft |
