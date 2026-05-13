# 0005 — RFC: Self-Serve Skills

**Status:** Draft — open for review
**Updated:** 2026-05-13
**Decides:** What's the minimum-viable UX for users to view, fork, scope, and publish skills — without becoming a YAML editor?

## Context

Two signals from the dogfood team:

1. A user explicitly asked: *"where can I understand more about the setup of this agent / possibly adjust it myself?"*
2. A different user shipped their own customer-filtering skill — by hand-editing YAML and shoving it into a Slack thread.

Both indicate the same thing: skills exist in the codebase but the team can't see them or change them from the product. The five power users have all hit the wall; the next twenty won't even get started.

`packages/skills` already has the primitives (parse, validate, redact, store, execute). What's missing is a UX layer that lets a non-engineer view a skill, fork it, change a default filter, and use the fork — all without leaving the web app.

## What we're solving (and what we're not)

**We are:** exposing skills as first-class product objects, with a list page, a detail/edit page, a fork affordance, and a "default filters" surface that doesn't require knowing YAML.

**We are not:** building a visual no-code prompt designer. The skill source stays YAML; the UI exposes a structured editor for the safe parts (description, defaults, source scopes, tone) and a YAML escape-hatch for everything else.

## Proposed shape

### Surfaces

`/skills` — list of org skills, with per-skill status (draft, active, archived), version, last-edited-by, last-used-at, and a "fork" / "use" button.

`/skills/[slug]` — detail page. Renders:

- **Description** (from frontmatter, plain markdown)
- **What it pulls from** (source scopes, account filters, tier filters)
- **What it does** (the prompt body, rendered as collapsed markdown by default)
- **Tools it can call** (`toolAllowlist`)
- **Forks** — list of forks the org owns, with author + edit-date
- **Run it** button — opens `/chat?skill=<slug>` with the skill activated

`/skills/[slug]/edit` — structured editor with three modes:

1. **Form mode** (default) — typed fields for description, source scopes, default filters (account / time-window / tier), tone preset, model. Saves to the YAML's known keys.
2. **Body mode** — markdown editor for the prompt body. Validates against `parseSkill`.
3. **YAML mode** — raw editor + live `parseSkill` error display. Disabled by default; togglable under a "show advanced" affordance.

### Forking

"Fork" creates a new row in `skills` with:

- `slug = '<original-slug>-<short-suffix>'` (configurable at fork time)
- `parent_skill_id` pointing at the original
- `version = 1`
- `status = 'draft'`

The form editor opens immediately on the new fork. Saving moves it to `active`. Forks belong to the org; cross-org forking (via marketplace, RFC-future) is *not* in scope here.

### Default filters surface

The most-requested customization in the dogfood export is per-skill default filters. Schema addition to the skill frontmatter:

```yaml
defaults:
  accountFilter: { tier: ['T0', 'T1'] }      # optional
  timeWindow: { last: '14d' }                # optional
  provider: ['pylon', 'grain']               # optional
```

These get merged into every `search` call made by the skill (orchestrator side, not model side — defaults must be enforceable, not suggestible). The model can still ask for narrower filters within the defaults; it cannot widen them.

### Permissions

- **View** — every member.
- **Fork** — every member (forks land in the member's own "drafts").
- **Promote to org-active** — owner / admin only (Better Auth roles already exist).
- **Edit an org-active skill** — owner / admin only. Members fork-then-edit-then-PR.

Audit log entries: `skill.fork`, `skill.edit`, `skill.promote`, `skill.archive`.

## Open questions

1. **Markdown body editor — plain textarea, CodeMirror, or a real Markdown editor (tiptap)?** **Recommend:** CodeMirror with Markdown syntax + the existing `parseSkill` validation in the gutter. tiptap is overkill for a YAML-adjacent format and we'd fight WYSIWYG-to-source roundtripping.
2. **Versioning — bump on every save, or explicit "publish"?** **Recommend:** explicit publish. Saves are autosaved drafts; "publish" bumps `version` and promotes the new version to `active`. Mirrors how the team already thinks about skills ("the new version of the support-question agent").
3. **Default filter conflicts with model intent.** If the skill says `tier: ['T0']` and the user asks "everyone asking about X", does the model ignore the user or honor the skill? **Recommend:** honor the skill, *and* surface "Filtered to T0 by skill default — clear filter" in the response (UI-side, not model-side). Predictable > clever.
4. **Marketplace.** Cross-org skill sharing is on the roadmap (v0.3). This RFC stops at the org boundary; the marketplace lands its own RFC.

## Tradeoffs to lock down

- **Two editors or one?** A form editor is welcoming but inevitably leaks into "I want to edit the prompt." A single YAML editor is powerful but scares off the audience. **We need both, with form-first.** The YAML escape-hatch is the safety valve, not the goal.
- **Live preview vs. save-and-run.** Live preview against a sample query is delightful but adds a non-trivial orchestrator round-trip per keystroke. **Cut for v1.** Add a "test this skill" button that runs once on demand.
- **Source scope as filter vs. as gate.** A skill's source scope can mean "search only these connectors" (filter) or "this skill is only legal when these connectors are connected" (gate). **They're different.** v1 ships filter semantics; gate semantics ("disable skill when Pylon disconnected") is a follow-up.

## Out of scope (initial PR)

- Cross-org marketplace
- Skill versioning rollback / history viewer (just keep the rows)
- Live preview
- Visual node-based prompt designer
- Auto-suggesting skills from chat history

## Recommendation

Build `/skills`, `/skills/[slug]`, `/skills/[slug]/edit` (form + body + YAML modes) and the fork/promote/archive lifecycle. Ship default filters as a structured form. Audit-log every state transition. Defer marketplace, versioning history, and live preview.

Depends on:

- Existing `packages/skills` primitives (✅)
- Better Auth roles for promote permissions (✅)
- PR #184 (✅) — `accountFilter.tier` needs the customer entity
- DESIGN.md — list/detail/edit visual patterns already partly defined; confirm the editor density with one round of review before merging
