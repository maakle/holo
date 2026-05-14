-- Google Chat App (bot) integration. Mirrors the Slack app tables:
--   - google_chat_app_configs  ↔ slack_app_configs   (EE BYO-app creds)
--   - google_chat_workspaces   (no Slack analog — customerNumber → org)
--   - google_chat_event_dedupe ↔ slack_event_dedupe
--   - google_chat_answer_index ↔ slack_answer_index  (RFC-0008 anchor)
--
-- This is the conversational Chat App. The existing read-only ingestion
-- connector (packages/connectors/src/google-chat/) shares no tables with
-- it; they live side by side.

CREATE TABLE "google_chat_app_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_account_json" text NOT NULL,
	"audience" text NOT NULL,
	"display_name" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_chat_app_configs" ADD CONSTRAINT "google_chat_app_configs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_chat_app_configs" ADD CONSTRAINT "google_chat_app_configs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_app_configs_org_uniq" ON "google_chat_app_configs" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE "google_chat_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_chat_workspaces" ADD CONSTRAINT "google_chat_workspaces_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_workspaces_customer_number_uniq" ON "google_chat_workspaces" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "google_chat_workspaces_org_idx" ON "google_chat_workspaces" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE "google_chat_event_dedupe" (
	"space_name" text NOT NULL,
	"message_name" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_event_dedupe_space_message_uniq" ON "google_chat_event_dedupe" USING btree ("space_name","message_name");--> statement-breakpoint
CREATE INDEX "google_chat_event_dedupe_received_at_idx" ON "google_chat_event_dedupe" USING btree ("received_at");--> statement-breakpoint

CREATE TABLE "google_chat_answer_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"space_name" text NOT NULL,
	"message_name" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sources_jsonb" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_chat_answer_index" ADD CONSTRAINT "google_chat_answer_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_answer_index_answer_id_uniq" ON "google_chat_answer_index" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_chat_answer_index_space_message_uniq" ON "google_chat_answer_index" USING btree ("space_name","message_name");
