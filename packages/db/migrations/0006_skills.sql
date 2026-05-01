CREATE TABLE IF NOT EXISTS "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'draft',
  "content" text NOT NULL,
  "source_artifact_ids" uuid[] NOT NULL DEFAULT '{}'::uuid[],
  "fingerprint" text NOT NULL,
  "stale_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "user"("id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skills_org_status_idx" ON "skills" ("organization_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "skills_org_slug_version_uniq" ON "skills" ("organization_id", "slug", "version");
