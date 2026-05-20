-- Pricing model v2 (RFC 0010 / ADR 0007 — workspace credit-pool pricing).
--
-- The old ladder (Starter $20 / Team $50 / Business $200, with 500K/2M/10M
-- monthly credits) priced the product 5–50x under value at scale and burned
-- the trial in one chat. New ladder anchors closer to Glean while keeping
-- self-serve up to Business.
--
-- Strategy: rename the existing starter/team/business plans to a `-legacy-2026-05`
-- suffix and mark them non-public. Existing customer subscriptions reference
-- billing_plans by UUID, so they grandfather automatically — same Stripe
-- subscription, same monthly grant, same price. Then INSERT new rows under
-- the canonical 'starter' / 'team' / 'business' slugs with the new prices and
-- pool sizes. The Stripe Price for each new row is provisioned on next worker
-- boot via ensureStripeProductsForPlans (matches by lookup_key = slug).
--
-- 'free' and 'enterprise' are unchanged in this migration. The trial mechanic
-- that replaces 'free' lands in a later migration (see RFC 0010 § W3 / M2).
-- Pool-size variants (Light / Heavy / Always-on dropdown) land in B1.2.

UPDATE "billing_plans" SET slug = 'starter-legacy-2026-05',  is_public = false WHERE slug = 'starter';
UPDATE "billing_plans" SET slug = 'team-legacy-2026-05',     is_public = false WHERE slug = 'team';
UPDATE "billing_plans" SET slug = 'business-legacy-2026-05', is_public = false WHERE slug = 'business';
--> statement-breakpoint

INSERT INTO "billing_plans" (slug, name, monthly_credits, monthly_price_cents, features, is_public) VALUES
  ('starter',  'Starter',  250000,    9900,   '{"maxConnectors":5,    "syncIntervalTier":"standard","sampleDataIncluded":true}'::jsonb, true),
  ('team',     'Team',     2000000,   49900,  '{"maxConnectors":null, "syncIntervalTier":"standard","sampleDataIncluded":true}'::jsonb, true),
  ('business', 'Business', 10000000,  199900, '{"maxConnectors":null, "syncIntervalTier":"priority","sampleDataIncluded":true}'::jsonb, true);
