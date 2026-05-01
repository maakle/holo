CREATE TABLE IF NOT EXISTS "published_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "skill_id" text NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "redacted_content" text NOT NULL,
  "published_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "published_skills_published_at_idx" ON "published_skills" ("published_at" DESC);
