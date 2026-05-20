CREATE TABLE "billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"monthly_credits" bigint NOT NULL,
	"monthly_price_cents" integer NOT NULL,
	"stripe_price_id" text,
	"features" jsonb DEFAULT '{"maxConnectors":null}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"credits" bigint NOT NULL,
	"reason" text NOT NULL,
	"reference_kind" text,
	"reference_id" text,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "credit_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"selector" text NOT NULL,
	"credits_per_unit" numeric(20, 8) NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_subscriptions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text DEFAULT 'unbilled' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_ledger_org_kind_created_idx" ON "credit_ledger" USING btree ("organization_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_ledger_org_reason_created_idx" ON "credit_ledger" USING btree ("organization_id","reason","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_prices_kind_selector_from_idx" ON "credit_prices" USING btree ("kind","selector","effective_from" DESC NULLS LAST);--> statement-breakpoint

-- View exposing the current credit balance per org as a deterministic fold
-- of credit_ledger. Reads use this; never query credit_ledger directly for
-- balance. Cheap given (organization_id, created_at) indexes above; promote
-- to a materialized view if the table ever gets large enough to matter.
CREATE VIEW "org_credit_balance" AS
  SELECT
    organization_id,
    COALESCE(SUM(credits), 0)::bigint AS balance,
    COALESCE(SUM(credits) FILTER (WHERE kind = 'debit'), 0)::bigint AS debits_total,
    COALESCE(SUM(credits) FILTER (WHERE kind IN ('grant', 'topup', 'refund', 'adjustment')), 0)::bigint AS grants_total
  FROM credit_ledger
  GROUP BY organization_id;
--> statement-breakpoint

-- Seed plan catalogue. Slugs are stable identifiers used by application
-- code; rename `name` freely, never rename `slug` without a migration.
-- Prices are deliberately tunable via SQL — founder updates here, not in code.
INSERT INTO "billing_plans" (slug, name, monthly_credits, monthly_price_cents, features, is_public) VALUES
  ('free',       'Free',       25000,     0,     '{"maxConnectors":1,    "syncIntervalTier":"standard","sampleDataIncluded":true}'::jsonb, true),
  ('starter',    'Starter',    500000,    2000,  '{"maxConnectors":5,    "syncIntervalTier":"standard","sampleDataIncluded":true}'::jsonb, true),
  ('team',       'Team',       2000000,   5000,  '{"maxConnectors":null, "syncIntervalTier":"standard","sampleDataIncluded":true}'::jsonb, true),
  ('business',   'Business',   10000000,  20000, '{"maxConnectors":null, "syncIntervalTier":"priority","sampleDataIncluded":true}'::jsonb, true),
  ('enterprise', 'Enterprise', 0,         0,     '{"maxConnectors":null, "syncIntervalTier":"priority","sampleDataIncluded":true}'::jsonb, false);
--> statement-breakpoint

-- Seed price book. Token rates are per 1K tokens at ~30% gross margin over
-- Anthropic list. Sync artifact rate covers embedding + storage with margin.
-- Use selector='*' as the default fallback for any kind/selector combo not
-- listed (looked up by packages/billing/src/pricing.ts when a specific row
-- is missing).
INSERT INTO "credit_prices" (kind, selector, credits_per_unit) VALUES
  ('llm_input_tokens',    'claude-sonnet-4-6', 400),
  ('llm_output_tokens',   'claude-sonnet-4-6', 1950),
  ('cache_read_tokens',   'claude-sonnet-4-6', 40),
  ('cache_create_tokens', 'claude-sonnet-4-6', 500),
  ('llm_input_tokens',    'claude-opus-4-7',   1950),
  ('llm_output_tokens',   'claude-opus-4-7',   9750),
  ('cache_read_tokens',   'claude-opus-4-7',   195),
  ('cache_create_tokens', 'claude-opus-4-7',   2438),
  ('llm_input_tokens',    'claude-haiku-4-5',  130),
  ('llm_output_tokens',   'claude-haiku-4-5',  650),
  ('cache_read_tokens',   'claude-haiku-4-5',  13),
  ('cache_create_tokens', 'claude-haiku-4-5',  163),
  -- Defaults for unknown models (use Sonnet rates as a safe upper bound).
  ('llm_input_tokens',    '*',                 400),
  ('llm_output_tokens',   '*',                 1950),
  ('cache_read_tokens',   '*',                 40),
  ('cache_create_tokens', '*',                 500),
  -- Sync artifacts: per chunk inserted. Default 5 credits; premium connectors
  -- (Stripe ingestion is heavier) can be priced higher individually.
  ('sync_artifact',       '*',                 5),
  ('sync_artifact',       'stripe',            10);
--> statement-breakpoint

-- Backfill organisation_subscriptions for every existing org. Default to
-- `free` unless the org already has 2+ active connector_credentials rows —
-- those orgs are grandfathered onto `team` so we don't break working setups.
-- Period is month-rounded from now() so the first grant cron tick matches
-- the calendar month boundary.
INSERT INTO "organization_subscriptions" (
  organization_id, plan_id, status, current_period_start, current_period_end
)
SELECT
  o.id,
  CASE
    WHEN connector_count.n >= 2 THEN (SELECT id FROM billing_plans WHERE slug = 'team')
    ELSE (SELECT id FROM billing_plans WHERE slug = 'free')
  END AS plan_id,
  'unbilled',
  date_trunc('month', now()) AS current_period_start,
  (date_trunc('month', now()) + INTERVAL '1 month') AS current_period_end
FROM organization o
LEFT JOIN (
  SELECT organization_id, COUNT(*) AS n
  FROM connector_credentials
  WHERE status = 'active'
  GROUP BY organization_id
) AS connector_count ON connector_count.organization_id = o.id
ON CONFLICT (organization_id) DO NOTHING;
--> statement-breakpoint

-- Seed an initial grant ledger row for every org so balances are non-zero
-- immediately. Idempotency key 'seed:initial:<org_id>' matches the value the
-- Better Auth org-create hook will use, so future grants from that hook are
-- no-ops if the migration already ran for the same org.
INSERT INTO "credit_ledger" (
  organization_id, kind, credits, reason, reference_kind, reference_id,
  idempotency_key, metadata
)
SELECT
  s.organization_id,
  'grant',
  p.monthly_credits,
  'monthly_grant',
  'subscription',
  s.organization_id::text,
  'seed:initial:' || s.organization_id::text,
  jsonb_build_object('plan_slug', p.slug, 'period_start', s.current_period_start)
FROM organization_subscriptions s
JOIN billing_plans p ON p.id = s.plan_id
WHERE p.monthly_credits > 0
ON CONFLICT (idempotency_key) DO NOTHING;