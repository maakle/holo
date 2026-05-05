-- Procedure auto-discovery: episodes, proposals, and reviewer decisions.
-- Hand-authored: only the three new tables introduced in this branch.

CREATE TABLE "procedure_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_artifact_ids" uuid[] NOT NULL,
	"centroid_embedding" vector(1024),
	"entity_key" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"proposed_slug" text NOT NULL,
	"proposed_name" text NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_proposal_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"final_slug" text,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_episodes" ADD CONSTRAINT "procedure_episodes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_proposals" ADD CONSTRAINT "procedure_proposals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_proposals" ADD CONSTRAINT "procedure_proposals_episode_id_procedure_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."procedure_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_proposal_decisions" ADD CONSTRAINT "procedure_proposal_decisions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_proposal_decisions" ADD CONSTRAINT "procedure_proposal_decisions_proposal_id_procedure_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."procedure_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_proposal_decisions" ADD CONSTRAINT "procedure_proposal_decisions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_episodes_org_last_seen_idx" ON "procedure_episodes" USING btree ("organization_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "procedure_episodes_org_entity_idx" ON "procedure_episodes" USING btree ("organization_id","entity_key");--> statement-breakpoint
CREATE INDEX "procedure_proposals_org_status_created_idx" ON "procedure_proposals" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_proposals_org_episode_pending_uniq" ON "procedure_proposals" USING btree ("organization_id","episode_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "procedure_proposal_decisions_org_decided_at_idx" ON "procedure_proposal_decisions" USING btree ("organization_id","decided_at");
