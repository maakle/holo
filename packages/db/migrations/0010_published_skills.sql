CREATE TABLE IF NOT EXISTS "published_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "redacted_content" text NOT NULL,
  "published_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "published_skills_published_at_idx" ON "published_skills" ("published_at" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "published_skills_skill_id_uniq" ON "published_skills" ("skill_id");
