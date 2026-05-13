CREATE TABLE "slack_app_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"app_id" text,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"signing_secret" text NOT NULL,
	"display_name" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connector_credentials" ADD COLUMN "slack_app_config_id" uuid;--> statement-breakpoint
ALTER TABLE "slack_app_configs" ADD CONSTRAINT "slack_app_configs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_app_configs" ADD CONSTRAINT "slack_app_configs_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_app_configs_org_uniq" ON "slack_app_configs" USING btree ("organization_id");