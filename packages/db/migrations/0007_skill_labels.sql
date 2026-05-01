CREATE TABLE IF NOT EXISTS "skill_labels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "source_artifact_id" uuid NOT NULL REFERENCES "source_artifacts"("id") ON DELETE CASCADE,
  "skill_slug" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "skill_labels_org_slug_idx" ON "skill_labels" ("organization_id", "skill_slug");
CREATE UNIQUE INDEX IF NOT EXISTS "skill_labels_org_artifact_slug_uniq" ON "skill_labels" ("organization_id", "source_artifact_id", "skill_slug");
