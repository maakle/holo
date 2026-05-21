-- Rename the JSONB sub-key `maxStoredArtifacts` → `maxStoredChunks` on every
-- `billing_plans.features` row. The cap is enforced against the `chunks`
-- table (one row per embedding vector), so the old name was misleading —
-- artifacts are a different concept (source items per sync run, tracked in
-- `sync_runs.artifact_count`).
--
-- Preserves the original value, including explicit `null` (the Enterprise
-- "unlimited" sentinel). Operates only on rows that actually have the old
-- key, so it's idempotent against a partially-migrated DB.

UPDATE billing_plans
SET features = (features - 'maxStoredArtifacts')
            || jsonb_build_object('maxStoredChunks', features->'maxStoredArtifacts')
WHERE features ? 'maxStoredArtifacts';
