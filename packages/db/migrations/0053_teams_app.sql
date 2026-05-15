-- Microsoft Teams Bot integration. Mirrors the Slack and Google Chat
-- app tables:
--   - teams_app_configs   ↔ slack_app_configs / google_chat_app_configs
--     (EE BYO Azure AD bot registration per org)
--   - teams_installations (tenant_id → org; one tenant ↔ exactly one org)
--   - teams_event_dedupe  ↔ slack_event_dedupe / google_chat_event_dedupe
--   - teams_answer_index  ↔ slack_answer_index / google_chat_answer_index
--     (RFC-0008 anchor for reaction-based feedback)

CREATE TABLE "teams_app_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"app_secret" text NOT NULL,
	"app_tenant_id" text,
	"display_name" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams_app_configs" ADD CONSTRAINT "teams_app_configs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_app_configs" ADD CONSTRAINT "teams_app_configs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_app_configs_org_uniq" ON "teams_app_configs" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE "teams_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"tenant_display_name" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams_installations" ADD CONSTRAINT "teams_installations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_installations_tenant_id_uniq" ON "teams_installations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "teams_installations_org_idx" ON "teams_installations" USING btree ("organization_id");--> statement-breakpoint

CREATE TABLE "teams_event_dedupe" (
	"tenant_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_event_dedupe_tenant_activity_uniq" ON "teams_event_dedupe" USING btree ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "teams_event_dedupe_received_at_idx" ON "teams_event_dedupe" USING btree ("received_at");--> statement-breakpoint

CREATE TABLE "teams_answer_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"service_url" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sources_jsonb" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams_answer_index" ADD CONSTRAINT "teams_answer_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "teams_answer_index_answer_id_uniq" ON "teams_answer_index" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_answer_index_conversation_activity_uniq" ON "teams_answer_index" USING btree ("tenant_id","conversation_id","activity_id");
