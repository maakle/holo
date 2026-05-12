-- Bridges the OAuth callback origin (WEB_PUBLIC_URL — where the better-auth
-- session cookie isn't readable) to /connections/oauth-finalize on
-- BETTER_AUTH_URL (where it is). The callback exchanges the OAuth code,
-- encrypts the tokens + provider-specific payload into `payload`, and writes
-- a row keyed by the JWT-claimed (user, org). The finalize page asserts
-- `session.user.id === claimed_user_id` before committing — defense against
-- an attacker replaying their own state JWT against a victim's browser to
-- land the victim's tokens under the attacker's org. Rows are short-lived
-- (~2 min) and one-shot (consumed_at flips on first successful finalize).
CREATE TABLE "oauth_pending_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"claimed_user_id" uuid NOT NULL,
	"claimed_organization_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "oauth_pending_grants" ADD CONSTRAINT "oauth_pending_grants_claimed_user_id_user_id_fk" FOREIGN KEY ("claimed_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_pending_grants" ADD CONSTRAINT "oauth_pending_grants_claimed_organization_id_organization_id_fk" FOREIGN KEY ("claimed_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_pending_grants_expires_idx" ON "oauth_pending_grants" USING btree ("expires_at") WHERE "oauth_pending_grants"."consumed_at" IS NULL;