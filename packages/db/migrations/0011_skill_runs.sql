CREATE TABLE IF NOT EXISTS "skill_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "triggered_by" uuid REFERENCES "user"("id"),
  "input" jsonb NOT NULL DEFAULT '{}',
  "steps" jsonb NOT NULL DEFAULT '[]',
  "status" text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "skill_runs_org_status_idx" ON "skill_runs" ("organization_id", "started_at");
CREATE INDEX IF NOT EXISTS "skill_runs_skill_idx" ON "skill_runs" ("skill_id");
