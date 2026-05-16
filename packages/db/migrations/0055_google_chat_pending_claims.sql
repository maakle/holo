-- One-time DM-bind claim tokens for the Google Chat connector. Created
-- when the gateway receives a MESSAGE event with a `user.domainId` that
-- doesn't yet map to a Holo org. The bot replies with a signed link
-- (`/connect-agent/google-chat/claim?token=…`); when the asker clicks it
-- while signed into Holo, the server verifies the token and writes a
-- `google_chat_workspaces` row.

CREATE TABLE "google_chat_pending_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"domain_id" text NOT NULL,
	"asker_email" text,
	"asker_user_name" text,
	"space_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_by_org_id" uuid
);
--> statement-breakpoint
ALTER TABLE "google_chat_pending_claims" ADD CONSTRAINT "google_chat_pending_claims_claimed_by_org_id_organization_id_fk" FOREIGN KEY ("claimed_by_org_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_pending_claims_token_hash_uniq" ON "google_chat_pending_claims" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "google_chat_pending_claims_expires_idx" ON "google_chat_pending_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "google_chat_pending_claims_domain_idx" ON "google_chat_pending_claims" USING btree ("domain_id");
