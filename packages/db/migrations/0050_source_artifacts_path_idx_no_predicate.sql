-- Simplify source_artifacts_org_path_idx now that `path` is NOT NULL.
--
-- Migration 0048 created the index with `WHERE path IS NOT NULL AND
-- deleted_at IS NULL` so it stayed small while `path` could legitimately
-- be NULL during the RFC 0009 rollout. Migration 0049 then locked
-- `path` to NOT NULL — half of the predicate is now always-true and the
-- planner wastes plan time evaluating it.
--
-- The `deleted_at IS NULL` half is still useful: tombstoned artifacts
-- shouldn't be served from /files or bash. Keep it.
DROP INDEX IF EXISTS "source_artifacts_org_path_idx";
CREATE INDEX "source_artifacts_org_path_idx"
  ON "source_artifacts" USING btree ("organization_id", "path")
  WHERE "source_artifacts"."deleted_at" IS NULL;
