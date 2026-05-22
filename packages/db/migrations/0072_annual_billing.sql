-- Annual billing (RFC TBD): add upfront-annual prices for all paid plans
-- at a ~15% discount vs. month-by-month. Customers select monthly or annual
-- at Stripe Checkout; the webhook handler detects the period interval from
-- the Stripe subscription's period duration (> 60 days = annual) and grants
-- 12× monthlyCredits at the start of each annual period.
--
-- Annual credits are issued upfront, not metered monthly within the year —
-- customers who commit annually accept that they could in principle burn
-- through 12 months of credits in month 1. Top-ups remain available for
-- the overage band.
--
-- Free and Enterprise stay annual-price NULL: Free has no Stripe product
-- and Enterprise is custom-priced per deal.
--
-- Stripe Prices for annual are auto-provisioned on next worker boot by
-- `ensureStripeProductsForPlans`, mirroring how monthly Prices are wired.

ALTER TABLE "billing_plans"
  ADD COLUMN IF NOT EXISTS "annual_price_cents" integer,
  ADD COLUMN IF NOT EXISTS "stripe_annual_price_id" text;
--> statement-breakpoint

-- Seed annual prices: 15% off list. Monthly-equivalent rounded to clean dollars:
--   Starter  $99/mo  →  $84/mo annual ($1,008/yr)
--   Team    $499/mo  → $424/mo annual ($5,088/yr)
--   Scale   $999/mo  → $849/mo annual ($10,188/yr)
--   Business $1999/mo → $1,699/mo annual ($20,388/yr)
UPDATE "billing_plans" SET annual_price_cents = 100800   WHERE slug = 'starter';
UPDATE "billing_plans" SET annual_price_cents = 508800   WHERE slug = 'team';
UPDATE "billing_plans" SET annual_price_cents = 1018800  WHERE slug = 'scale';
UPDATE "billing_plans" SET annual_price_cents = 2038800  WHERE slug = 'business';
