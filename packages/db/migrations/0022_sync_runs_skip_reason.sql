-- Distinguishes "ran and found nothing new" from "didn't have anything to
-- scan" (e.g. Slack sync triggered with zero channels selected). Without
-- this, both states render as "up to date" in the UI, which masks misconfig.

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "skip_reason" text;
