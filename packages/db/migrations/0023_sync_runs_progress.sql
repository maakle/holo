-- Heartbeat columns: connectors update these mid-run so the dashboard can
-- show "12 / 47 pages — Indexing Engineering Wiki" instead of an opaque
-- spinner. Cleared on each fresh start in startSyncRun().
ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "progress_current" integer,
  ADD COLUMN IF NOT EXISTS "progress_total" integer,
  ADD COLUMN IF NOT EXISTS "progress_message" text;
