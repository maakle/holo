ALTER TABLE "connector_cursors"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
