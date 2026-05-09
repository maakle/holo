-- Per-CTO replay view tracking (CP2). One row per time a user opens an
-- MCP-invocation replay page; aggregations use COUNT DISTINCT for the
-- "how many users have actually clicked into a replay" metric.
CREATE TABLE "replay_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mcp_invocation_id" uuid NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "replay_views" ADD CONSTRAINT "replay_views_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_views" ADD CONSTRAINT "replay_views_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_views" ADD CONSTRAINT "replay_views_mcp_invocation_id_mcp_invocations_id_fk" FOREIGN KEY ("mcp_invocation_id") REFERENCES "public"."mcp_invocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "replay_views_org_viewed_idx" ON "replay_views" USING btree ("organization_id","viewed_at");--> statement-breakpoint
CREATE INDEX "replay_views_org_user_idx" ON "replay_views" USING btree ("organization_id","user_id");