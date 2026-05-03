# Contributing

Thanks for thinking about contributing. Holo is in early active development. The architecture decisions are settled (see `docs/ARCHITECTURE.md`) but everything on top is open territory.

## Before you start

1. **Read `docs/ARCHITECTURE.md`.** It captures the decisions and why. PRs that contradict them without strong new evidence will get pushback.
2. **Read `docs/VISION.md`** to understand what Holo is *for*. Search products and Holo are not the same thing — the skill layer is the differentiator.
3. **Check the roadmap** in `docs/ROADMAP.md` to see what milestone we're in.
4. **Look at issues tagged `good-first-issue`** if you want a contained task.
5. **For anything bigger than a small fix, open an issue first.**

## Setup

```bash
git clone https://github.com/your-org/holo.git
cd holo
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:migrate
pnpm dev
```

## Project shape

- **Monorepo:** pnpm workspaces + Turborepo
- **Apps:** `apps/web` (Next.js), `apps/worker` (NestJS standalone), `apps/gateway` (Hono — MCP + REST)
- **Packages:** `packages/db` (Drizzle), `packages/auth` (Better Auth), `packages/connectors`, `packages/retrieval-core`, `packages/skills` (v0.5), `packages/plans` (v0.6), `packages/jobs`, `packages/contracts`, `packages/api-client`, `packages/ui`

## Conventions

- **TypeScript everywhere.** No JavaScript files in `src/`.
- **Drizzle for all DB access.** No raw SQL outside vector/search-specific cases that have been discussed.
- **Zod for all input validation.** Schemas live in `packages/contracts`.
- **No new dependencies without justification.** Open an issue first.
- **Defensive DDL.** All migrations use `IF NOT EXISTS` / `IF EXISTS`. Drizzle `push` is banned in CI.
- **No `any`.** If you really need it, leave a comment explaining why.

## Commit and PR style

- **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope where useful: `feat(connectors/slack): incremental sync`.
- **One logical change per PR.**
- **Tests for new behavior.** Unit for pure logic, integration for anything touching DB or queues.
- **PR description must include:** what, why, how to test, screenshots if UI.

## Adding a connector

The most common contribution path. Shape:

1. Open an issue: "Add `<provider>` connector"
2. Implement `Connector<TConfig, TResource>` from `packages/connectors`
3. OAuth install flow + token encryption
4. `fullSync` and `incrementalSync` with checkpoints
5. Webhook verification + normalization
6. **ACL extraction** (most important — see below)
7. Per-source chunker if needed
8. Integration tests against fixtures
9. Documentation

**ACL extraction is non-negotiable.** Every connector must populate `acl_subjects text[]` on each document with the source's native permissions. If you can't figure out a source's permission model, ask in the issue before starting.

## Adding a skill (v0.5+)

When `packages/skills` lands in v0.5, the contribution path for skills will be:

1. Open an issue describing the procedure to encode (e.g., "skill: handle_pagerduty_incident")
2. Author or generate a `SKILL.md` matching the Anthropic Skill format
3. Define source artifacts the synthesizer should pull from
4. Add to fixtures with golden inputs/outputs for evaluation
5. Test against the eval harness
6. Submit for community review

Skill quality is more important than skill quantity.

## Architectural decisions

If your change involves a non-obvious design choice, add a short ADR to `docs/decisions/`:

```
docs/decisions/0042-rerank-default-on-search.md
```

Format: Context, Decision, Consequences. Under a page.

## Code of conduct

Be kind. Be technical. Be specific. Disagreement is welcome; condescension is not.

## License

By submitting a PR you agree to license your contribution under AGPL-3.0-or-later.
