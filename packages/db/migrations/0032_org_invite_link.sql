-- Holo-native shareable invite link, one per organization. Used by the
-- /join/<token> route to add anyone signed in as a 'member' of the org.
-- Regenerate replaces `token`; revoke deletes the row. better-auth's
-- per-email invitation flow remains untouched.

CREATE TABLE IF NOT EXISTS "org_invite_link" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invite_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "org_invite_link"
		ADD CONSTRAINT "org_invite_link_organization_id_organization_id_fk"
		FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "org_invite_link"
		ADD CONSTRAINT "org_invite_link_created_by_user_id_fk"
		FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
