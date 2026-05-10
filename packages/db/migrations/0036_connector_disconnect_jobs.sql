-- Tracks in-flight async cleanup after a user disconnects a connector.
-- The DELETE /api/connectors/:provider/connection route runs the bounded,
-- time-sensitive bits synchronously (revoke token, remote uninstall, drop
-- credential/installation/SA rows, drain BullMQ) and inserts a row here, then
-- enqueues the slow `db.delete(sources)` cascade onto the worker's
-- `disconnect-cleanup` queue. The dashboard reads `finished_at IS NULL` rows
-- to render a "Disconnecting…" state and to block re-connects until cleanup
-- has actually finished.
CREATE TABLE "connector_disconnect_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "connector_disconnect_jobs" ADD CONSTRAINT "connector_disconnect_jobs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_disconnect_jobs_org_provider_pending_uniq" ON "connector_disconnect_jobs" USING btree ("organization_id","provider") WHERE "connector_disconnect_jobs"."finished_at" IS NULL;