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
pnpm bootstrap     # generates .env with random secrets, starts postgres + redis, runs migrations
pnpm dev       # runs web + gateway + worker locally with hot reload
```

`pnpm bootstrap` is idempotent — safe to re-run. To reset the database, run `docker compose down -v && pnpm bootstrap`.

Before `pnpm dev` boots, [scripts/check-env.mjs](./scripts/check-env.mjs) validates that every boot-required env var is filled in. If `.env` is missing GitHub OAuth credentials (which `pnpm bootstrap` doesn't generate — you need to create the OAuth app), it tells you exactly what to add.

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
- **Migration meta is checked in CI.** `pnpm db:check` enforces: contiguous `idx`, monotonic `when`, every `_journal.json` entry has a matching `<tag>.sql`, every `<tag>.sql` has a journal entry, and the latest entry has a snapshot. Run it locally before opening a migration PR. If you hit a numbering collision (two PRs grabbing the same `0034`), bump yours rather than introducing a `b` suffix — the suffixed style is grandfathered but warned-on.
- **No `any`.** ESLint enforces `@typescript-eslint/no-explicit-any: error`. If a third-party type literally requires it (Hono generics, dynamic `import()`'s default-export reshape), add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` with a one-line comment explaining why.
- **Org-scoped routes use `withActiveOrg`.** New API routes under `apps/web/src/app/api/` should `export const GET = withActiveOrg(async ({ ctx, orgId, params }) => …)` instead of hand-rolling session lookup + `resolveActiveOrgId` + try/catch. The wrapper makes "no orgId" structurally impossible and centralizes `HoloError → status` mapping.
- **Track new features in PostHog.** When you ship anything user-visible, add a corresponding event in the same PR. Web events go in `apps/web/src/lib/posthog/events.ts`; gateway/worker events use the helpers in `apps/gateway/src/posthog.ts` and `apps/worker/src/posthog.ts`. Full guide and current taxonomy: [`docs/analytics.md`](./docs/analytics.md).

## Commit and PR style

- **Conventional Commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope where useful: `feat(connectors/slack): incremental sync`.
- **One logical change per PR.**
- **Tests for new behavior.** Unit for pure logic, integration for anything touching DB or queues.
- **PR description must include:** what, why, how to test, screenshots if UI.

## Adding a migration

**Always start from `pnpm db:generate`.** Do not hand-author the `.sql`, `_journal.json`, or `meta/*_snapshot.json` files from scratch — drizzle-kit produces all three atomically and getting one out of step silently breaks future migrations.

The recipe:

1. Edit `packages/db/src/schema/*.ts` to reflect the desired schema.
2. Run `pnpm db:generate`. This produces:
   - `packages/db/migrations/<NNNN>_<tag>.sql` — the diff SQL
   - A new entry appended to `packages/db/migrations/meta/_journal.json`
   - `packages/db/migrations/meta/<idx>_snapshot.json` — the baseline drizzle will diff against for the *next* migration
3. Hand-edit the generated `.sql` if you need things drizzle can't express (seeds, custom indexes, `IF NOT EXISTS` wrappers around drizzle's `CREATE`s for idempotency). Do **not** edit the snapshot — it must match the schema TS exactly.
4. Run `pnpm db:check` locally. The repo-managed pre-commit hook (`.githooks/pre-commit`) also runs this whenever `packages/db/migrations/**` is touched; enable it via `pnpm install` once per clone (`prepare` script sets `core.hooksPath`).
5. Commit the `.sql`, `_journal.json`, and the new snapshot together.

**Data migrations (use this instead of `db:generate`).** For changes drizzle-kit can't see as a schema diff — JSONB sub-key renames, backfills, data corrections, `CREATE INDEX CONCURRENTLY`, RLS policies, view/function bodies, triggers — use the scaffolding script:

```bash
pnpm db:new-data-migration <snake_case_slug>
```

It writes the `.sql` stub, appends the journal entry (correct `idx`, monotonic `when`, matching tag), and copies the previous snapshot as the new baseline. Then fill in the SQL, edit any affected `src/schema/*.ts`, run `pnpm db:check && pnpm db:migrate`. Never hand-edit the journal or snapshot directly — getting any one of the three out of step silently breaks the next `pnpm db:generate`.

**Naming convention (footgun).** Three numbers refer to the same migration and they don't line up:

| Surface | Example | Source |
|---|---|---|
| SQL filename | `0062_credit_topup_packages.sql` | drizzle's per-migration counter (1-indexed in this repo by historical accident) |
| Journal `idx` | `61` | 0-indexed position in `_journal.json.entries` |
| Snapshot filename | `meta/0061_snapshot.json` | matches `idx`, zero-padded — **not** the tag prefix |

For tag `0062_*`, the snapshot is `0061_snapshot.json`. Always one less than the tag prefix. `pnpm db:generate` names it correctly — you only need to know this if you're hand-recovering a missing snapshot (rare; see the "If you skipped `db:generate`" note below).

**If two PRs grab the same number.** Bump yours rather than introducing a `b` suffix. The `0011b_*` / `0014b_*` style is grandfathered but warned-on by `pnpm db:check`.

**If you skipped `db:generate` and only have the `.sql`.** Run `pnpm db:generate` anyway — it will produce a spurious follow-up migration based on schema vs. last snapshot. Delete that `.sql`, revert the journal entry it added, and rename the new `meta/<n>_snapshot.json` to match the actual latest `idx`. (Or: just don't get into this state — step 1 of the recipe exists for a reason.)

## Adding a connector

The most common contribution path. Shape:

1. Open an issue: "Add `<provider>` connector"
2. Implement `Connector<TConfig, TResource>` from `packages/connectors`
3. OAuth install flow + token encryption
4. `fullSync` and `incrementalSync` with checkpoints
5. Webhook verification + normalization
6. **ACL extraction** (most important — see below)
7. Per-source chunker if needed
8. Register the new provider in the `SYNC_PROVIDERS` allowlists (see below) — without this the dashboard's Sync now / sync history / disconnect routes return `unknown provider`
9. **Register a path-fn** for each `kind` your chunker / connector emits in [`packages/chunker/src/path-fn.ts`](./packages/chunker/src/path-fn.ts) — see RFC 0009 (`docs/rfcs/0009-virtual-filesystem-over-context-layer.md`). Without this the artifact still upserts (worker checks `hasPathFn(kind)` and skips path computation gracefully) but rows have `path = NULL` and stay invisible in the file explorer + `bash` tool. Path conventions go in the registry; add a corresponding test case in [`packages/chunker/test/path-fn.test.ts`](./packages/chunker/test/path-fn.test.ts) covering at least the typical metadata shape.
10. Integration tests against fixtures
11. Documentation — add a setup guide under [`docs/connectors/`](./docs/connectors/) (see [`slack.md`](./docs/connectors/slack.md) for the template)

**ACL extraction is non-negotiable.** Every connector must populate `acl_subjects text[]` on each document with the source's native permissions. If you can't figure out a source's permission model, ask in the issue before starting.

**Register the provider in two places.** [`packages/sync-providers`](./packages/sync-providers/src/index.ts) is the single source of truth — the Drizzle schema enum, the dashboard's bulk-status poll, the CLI sync command, and the worker's queue topology all derive from it.

| File | What to add |
|---|---|
| [`packages/sync-providers/src/index.ts`](./packages/sync-providers/src/index.ts) | New entry in `SYNC_PROVIDERS` and `QUEUE_NAMES_BY_PROVIDER`. The schema enum, dashboard routes, CLI, and worker all import from here. |
| [`apps/web/src/lib/connector-registry.ts`](./apps/web/src/lib/connector-registry.ts) | New entry in `CONNECTORS` (display name, category, flow type) so the connector renders on the connections page. |

You will also need to add a `@Processor` for each new queue under [`apps/worker/src/queues/`](./apps/worker/src/queues/) and an entry in `QUEUE_NAMES` / `QUEUE_CONCURRENCY` in [`apps/worker/src/queues/types.ts`](./apps/worker/src/queues/types.ts). The worker has a compile-time assertion that `QUEUE_NAMES` covers exactly the registry's queue set — TS will fail the build if you add to one without the other.

If you forget step 8, the connector will OAuth and ingest fine in the worker, but the dashboard will show `Use one of: …` instead of sync history — and "Sync now" / "Disconnect" will fail with the same error.

**Don't hardcode another provider list.** The bulk-status poll at [`apps/web/src/app/api/connectors/status/route.ts`](./apps/web/src/app/api/connectors/status/route.ts) used to keep its own hardcoded `PROVIDERS` array; new connectors silently dropped out of the response. Symptom: the connection wizard's first-sync step flashed "Sync finished — no new content" while the worker was actively indexing, and the dashboard's "Connect → Manage" flip + sync badges never updated. Always **import `SYNC_PROVIDERS` from `@holo/sync-providers`** rather than restating the list — every duplicate list is a future "no new content" bug.

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

Holo ships in two editions. The file path determines the license:

- **Community Edition (CE)** — everything **not** under a `**/ee/**` directory. Licensed under [AGPL-3.0](./LICENSE). By submitting a PR that touches CE files, you agree to license your contribution under AGPL-3.0.
- **Enterprise Edition (EE)** — everything under a `**/ee/**` directory. Licensed under the [Enterprise License](./LICENSE-EE). By submitting a PR that touches EE files, you agree to the additional grant in `LICENSE-EE` § 3 — the maintainers retain the right to relicense your contribution (including under AGPL-3.0 or other terms) as part of the EE product.

Full breakdown in [`LICENSING.md`](./LICENSING.md). If you're not sure which edition a file belongs to, check its path — there is no third tier.
