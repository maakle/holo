-- Better Auth `organization` plugin: enable multi-tenancy.
--
-- Adds:
--   * member       — a user can be in N orgs (role: owner|admin|member|...)
--   * invitation   — pending email invites to join an org
--   * session.active_organization_id — the org currently scoped on a session
--
-- Backfill:
--   For every existing user, insert a `member` row tying them to their
--   `user.organization_id` with role='owner'. This preserves the v0.0
--   single-tenant assumption (every user already had exactly one org)
--   while unlocking multi-tenancy for new users.
CREATE TABLE IF NOT EXISTS "member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_uniq" ON "member" ("organization_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_user_idx" ON "member" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" timestamptz NOT NULL,
  "inviter_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_org_email_idx" ON "invitation" ("organization_id", "email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_status_idx" ON "invitation" ("status", "expires_at");
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "active_organization_id" uuid REFERENCES "organization"("id") ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO "member" ("organization_id", "user_id", "role")
SELECT u."organization_id", u."id", 'owner'
FROM "user" u
LEFT JOIN "member" m
  ON m."user_id" = u."id" AND m."organization_id" = u."organization_id"
WHERE m."id" IS NULL;
