-- Customer/end-customer entity from the POV of a Holo tenant. One row per
-- HubSpot Company / Pylon Account / Salesforce Account, merged by per-source
-- external id (organization-scoped). Stamped on chunks at ingest so retrieval
-- can filter by customer without a dedicated UI surface. Resolution is
-- implicit: connectors emit metadata hints (`customer_account_upsert` /
-- `customer_account_hint`) and the worker's embed-insert path upserts/looks
-- up the row before the bulk chunk insert. See
-- `packages/connectors/src/shared/customer-accounts.ts` for the runtime.
--
-- Distinct from `organization` (the Holo tenant — our paying customer) and
-- from Better Auth's `account` table (the user's OAuth identity).
CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"primary_domain" text,
	"domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"hubspot_company_id" text,
	"pylon_account_id" text,
	"salesforce_account_id" text,
	"arr_amount" numeric(14, 2),
	"arr_currency" text,
	"tier" text,
	"owner_email" text,
	"lifecycle_stage" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_accounts_org_idx" ON "customer_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "customer_accounts_org_primary_domain_idx" ON "customer_accounts" USING btree ("organization_id","primary_domain");--> statement-breakpoint
CREATE INDEX "customer_accounts_domains_gin_idx" ON "customer_accounts" USING gin ("domains");--> statement-breakpoint
CREATE INDEX "customer_accounts_aliases_gin_idx" ON "customer_accounts" USING gin ("aliases");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_org_hubspot_uniq" ON "customer_accounts" USING btree ("organization_id","hubspot_company_id") WHERE "customer_accounts"."hubspot_company_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_org_pylon_uniq" ON "customer_accounts" USING btree ("organization_id","pylon_account_id") WHERE "customer_accounts"."pylon_account_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_org_salesforce_uniq" ON "customer_accounts" USING btree ("organization_id","salesforce_account_id") WHERE "customer_accounts"."salesforce_account_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_org_account_idx" ON "chunks" USING btree ("organization_id","account_id") WHERE "chunks"."account_id" IS NOT NULL;