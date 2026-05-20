-- Credit top-up packages (RFC 0010 / ADR 0007 — pivoted from pool-size
-- variants to one-shot top-ups for simplicity).
--
-- Customers on any tier can buy a fixed-size bundle of credits at any time.
-- Each package is its own non-recurring Stripe Price (provisioned at boot via
-- ensureStripeProductsForTopupPackages). Purchase flow:
--
--   1. POST /api/stripe/topup/checkout { packageSlug } → Stripe Checkout URL
--   2. Customer pays
--   3. checkout.session.completed webhook arrives with metadata.topup_package_slug
--   4. Handler writes a `topup` row into credit_ledger; balance increments
--
-- Credits added via top-up have no `expires_at` — they roll over indefinitely.
-- (Compare: monthly grants from billing_plans are subject to whatever expiry
-- the grant cron writes. Top-up credits are explicitly purchased and persist.)

CREATE TABLE "credit_topup_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"credits" bigint NOT NULL,
	"price_cents" integer NOT NULL,
	"stripe_price_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_topup_packages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint

-- Seed three sensible sizes. Per-credit rate is mildly cheaper at larger
-- packages so picking the big one is rewarded; matches the variant-pricing
-- intuition without committing the customer to a monthly recurring increase.
--   small:  200K  / $50    → $0.25  / 1K credits
--   medium: 1M    / $200   → $0.20  / 1K credits  (-20%)
--   large:  3M    / $500   → $0.167 / 1K credits  (-33%)
INSERT INTO "credit_topup_packages" (slug, name, credits, price_cents, sort_order) VALUES
  ('topup-small',  'Small top-up',  200000,  5000,  0),
  ('topup-medium', 'Medium top-up', 1000000, 20000, 1),
  ('topup-large',  'Large top-up',  3000000, 50000, 2);
