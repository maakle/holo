# 0004 — RFC: Customer-Evidence Reports ("Talent Pool" report)

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** What's the shape of a templated multi-source synthesis report — a chat output, a generated artifact, or a dedicated reporting surface?

## Context

The single most-loved output in the dogfood export is the "talent pool" report — a synthesis across Pylon tickets, Grain calls, Notion product docs, and HubSpot deals that answers PM-flavored questions like:

> "Customers asking for X feature: who, what use case in their own words, current workarounds, ATSes affected, recommended product response."

Today the user types the whole brief into the agent, hand-edits the markdown, and pastes it into Notion. PMs would live in this view if it existed. It's the inverse of "draft customer reply" (RFC-0003): one-to-many synthesis rather than one-to-one drafting.

## What we're solving (and what we're not)

**We are:** turning "synthesize evidence across sources for a theme" into a templated artifact with structured rows, citations on every row, customer filters, and an export path.

**We are not:** building a generic BI / dashboard tool. Reports are *narrative* with structured backing data, not pivot tables. We're also not solving live-updating reports — each report is a snapshot of its time.

## Proposed shape

A new product surface `/reports` with three primitives:

1. **Report templates** — YAML at `packages/report-templates/*.yaml` that declare:
   - `theme` (free text — "Greenhouse integration", "renewal objections")
   - `rowSchema` — the columns the report produces (asks, customers, use case, workaround, integrations affected, product recommendation)
   - `sources` — which connector kinds to draw from
   - `filterSurface` — what filters the user can apply (time window, account filter, tier, owner)
   - `outputFormat` — markdown shape, suitable for Notion paste

2. **Report runs** — table `report_runs(id, organization_id, user_id, template_slug, params, status, started_at, completed_at, output_markdown, rows_jsonb)` plus `report_run_citations(report_run_id, row_index, chunk_id, ...)` linking each row back to its source chunks.

3. **A `/reports` UI** — list of past runs (org-scoped), a "new report" wizard that picks a template + fills filters, a run-detail page that renders the markdown with inline citation chips and a side-panel of underlying chunks.

### Runtime

Reports run async on the worker. The flow:

1. User picks template + fills filters → POST `/v1/reports`.
2. Worker resolves the theme into a set of queries (model decides — "find tickets about X", "find Grain calls mentioning Y"), executes each via the existing `searchWithCoverage`.
3. Across all retrieved chunks, the model groups by customer and synthesizes one row per customer per the template's `rowSchema`. Each row carries a `citations[]` array (same shape as RFC PR #188).
4. Output markdown is rendered server-side from `rows_jsonb` so the UI and the Notion export are byte-identical.

### Notion export

One-button "Export to Notion" appends the run's markdown to a target page chosen at run time. Uses the Notion connector's existing OAuth (write scope already requested for that integration). Citations export as Notion mentions / inline links when the source URL is known, plain text when it isn't.

## Open questions

1. **Template authoring — code or UI?** Initial templates ship as YAML in the repo (3–5 hand-built ones). Eventually a power user wants to fork them. **Recommend:** ship YAML-only in v1, defer in-app authoring to a follow-up that builds on RFC-0005 (self-serve skills). Forking a template should feel like forking a skill.
2. **Synthesis model — one call or per-customer fan-out?** A single long-context call gives the model the whole picture but caps row count and risks hallucinated cross-row patterns. A per-customer fan-out is parallel and bounded but loses cross-customer narrative ("this is the third T0 EU customer to ask for this"). **Recommend:** per-customer fan-out for rows + a second narrative-only synthesis call over the row outputs to write the report's intro/conclusion.
3. **Citation enforcement — soft or hard?** A row without citations is suspect. **Recommend:** hard — drop rows where the model didn't cite at least one source chunk. (Tie-in with RFC-0007: every claim, no exceptions.)
4. **Cost ceiling.** A "all customers asking for X" report could fan out to 200+ customers. **Recommend:** a per-template `maxCustomers` (default 25, configurable), and an explicit "expand to all (~$N)" affordance with a cost preview.

## Tradeoffs to lock down

- **Live vs. snapshot.** Reports are time-stamped snapshots. We do *not* re-run them on schedule (yet). A "re-run with same params" button makes refreshing one click. Scheduled re-runs land later, gated on real demand.
- **Customer filter source of truth.** Filters use the `customer_accounts` table from PR #184. ARR / tier / owner have to come from HubSpot ingestion — those fields are already on the entity, but we should sanity-check coverage before promising filters that fail silently for half the accounts.
- **Notion is the only export target at v1.** Slack message + CSV are tempting but multiply UX surface. Notion first; cut others if they don't show real demand.

## Out of scope (initial PR)

- Scheduled / recurring reports
- Drift detection between two runs of the same template
- In-app template authoring UI
- Multi-org sharing of templates
- Anything that auto-emails or auto-posts a report

## Recommendation

Ship template `talent-pool` as the v1 reference, plus three more (`renewal-risk`, `integration-asks`, `objection-rollup`). Build `/reports` as a standalone route. Use the per-customer fan-out synthesis, hard citation enforcement, Notion-only export. Layer scheduled runs and authoring UI later.

Depends on:

- PR #184 (✅) — customer entity + filters
- PR #188 (✅) — citation projection
- RFC-0007 — citation-enforcement primitive should be shared
- Notion connector write-scope verification (existing — confirm before scoping the PR)
