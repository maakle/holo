-- Shift Google Chat tenant→org routing to email-domain matching.
--
-- Why: the previous design (one-time signed claim link DM'd by the bot)
-- was overengineered for the actual auth requirement. We already have the
-- admin doing a real authenticated setup step in Holo; that's the right
-- moment to register the Workspace's verified email domains. Inbound bot
-- events carry `user.email`; matching the domain against this list is
-- sufficient and dramatically simpler than a token round-trip.
--
-- Schema changes:
--   - `google_chat_workspaces.primary_domains text[]` (NOT NULL, default
--     '{}'): the email domains that route to this org.
--   - `google_chat_workspaces.customer_number` becomes nullable + non-unique
--     (display-only now; not used for routing).
--   - Drop `google_chat_pending_claims` and its indexes — entire table is
--     dead code now.

ALTER TABLE "google_chat_workspaces" ADD COLUMN "primary_domains" text[] NOT NULL DEFAULT '{}'::text[];--> statement-breakpoint
CREATE INDEX "google_chat_workspaces_primary_domains_idx" ON "google_chat_workspaces" USING gin ("primary_domains");--> statement-breakpoint
DROP INDEX IF EXISTS "google_chat_workspaces_customer_number_uniq";--> statement-breakpoint
ALTER TABLE "google_chat_workspaces" ALTER COLUMN "customer_number" DROP NOT NULL;--> statement-breakpoint

DROP TABLE IF EXISTS "google_chat_pending_claims";
