-- Inbound Google Chat events do NOT include a `customerNumber` field on
-- the Event envelope or `space.customer` for DM contexts. They DO include
-- `user.domainId` (the Workspace tenant's numeric domain identifier).
--
-- We add `domain_id` as the actual lookup key for the inbound resolver.
-- `customer_number` stays for display + the existing claim flow; both can
-- coexist on a row, and over time `domain_id` becomes the source of truth.
--
-- Nullable for back-compat: existing rows have NULL until claimed (either by
-- updating the claim flow to capture domainId, or by a one-shot UPDATE once
-- the first inbound event is observed).

ALTER TABLE "google_chat_workspaces" ADD COLUMN "domain_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_workspaces_domain_id_uniq" ON "google_chat_workspaces" USING btree ("domain_id") WHERE "domain_id" IS NOT NULL;
