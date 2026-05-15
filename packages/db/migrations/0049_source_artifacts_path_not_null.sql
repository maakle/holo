-- Lock in the path invariant established by RFC 0009.
--
-- Migration 0048 added `path` as nullable so the worker could keep writing
-- through the rollout even before path-fns existed for every kind. Now
-- every connector that emits artifacts has a registered path-fn (including
-- stripe-{customer,subscription,invoice,charge} from the follow-up PR),
-- and 100% of LOCAL rows carry a non-null path.
--
-- Flipping to NOT NULL means: any future connector that emits a kind
-- without a path-fn fails loudly at insert time, instead of silently
-- writing path=NULL and disappearing from /files. This is what would have
-- surfaced the Stripe gap months sooner.
--
-- ---
--
-- Why the UPDATE comes first: in environments where this migration runs
-- BEFORE `apps/worker/scripts/backfill-paths.ts` has populated every row,
-- the SET NOT NULL would fail (`column "path" of relation
-- "source_artifacts" contains null values`). That happened on the first
-- prod deploy attempt. Solution: write a deterministic sentinel path for
-- any leftover NULL rows so the constraint can apply. The sentinel:
--   - is path-shaped (won't break HoloFs path parsing)
--   - encodes the artifact id (deterministic, idempotent across retries)
--   - lives under a synthetic root no connector ever emits, so operators
--     can find them via `path LIKE '/_unbackfilled/%'`
-- Running `backfill-paths.ts` after this migration picks these up and
-- replaces the sentinel with the proper path-fn output. See the
-- `WHERE path LIKE '/_unbackfilled/%'` branch in `path-backfill.ts`.
--
-- The partial index `source_artifacts_org_path_idx` (added in 0048) had
-- `WHERE path IS NOT NULL` — keep the predicate for now; we can drop it
-- in a later migration once tooling fully assumes NOT NULL. Two-step is
-- cheaper than recreating the index in this migration.
UPDATE "source_artifacts"
SET "path" = '/_unbackfilled/' || "id"::text
WHERE "path" IS NULL;--> statement-breakpoint
ALTER TABLE "source_artifacts" ALTER COLUMN "path" SET NOT NULL;
