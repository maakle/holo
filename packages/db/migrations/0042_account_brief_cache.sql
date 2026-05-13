-- RFC-0006 — Pre-Call Account Brief.
-- Cached output of `get_account_brief` per (organization, account, context, day).
-- The day partition gives a natural 24h TTL ("today's brief" vs "yesterday's")
-- without a sweeper, and same-day regenerate is UPSERT on the unique tuple.
CREATE TABLE "account_brief_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"context" text NOT NULL,
	"custom_context" text,
	"cache_day" date NOT NULL,
	"sections_jsonb" jsonb NOT NULL,
	"citations_jsonb" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "account_brief_cache" ADD CONSTRAINT "account_brief_cache_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_brief_cache" ADD CONSTRAINT "account_brief_cache_account_id_customer_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_brief_cache" ADD CONSTRAINT "account_brief_cache_generated_by_user_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_brief_cache_org_account_context_day_uniq" ON "account_brief_cache" USING btree ("organization_id","account_id","context","cache_day");--> statement-breakpoint
CREATE INDEX "account_brief_cache_org_account_generated_idx" ON "account_brief_cache" USING btree ("organization_id","account_id","generated_at");
