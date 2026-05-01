ALTER TABLE "skills"
  ADD COLUMN IF NOT EXISTS "tool_allowlist" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "executable" boolean NOT NULL DEFAULT false;
