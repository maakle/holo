-- Workspace-scoped Google service account credentials. Replaces per-user
-- OAuth for googledrive + google-chat: one row per (org, provider) holding
-- the JSON key and the Workspace user the SA impersonates via DWD.
CREATE TABLE "connector_service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"key_json" text NOT NULL,
	"impersonation_email" text NOT NULL,
	"service_account_email" text NOT NULL,
	"service_account_client_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_by_user_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "connector_service_accounts" ADD CONSTRAINT "connector_service_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_service_accounts" ADD CONSTRAINT "connector_service_accounts_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_service_accounts_org_provider_uniq" ON "connector_service_accounts" USING btree ("organization_id","provider");
