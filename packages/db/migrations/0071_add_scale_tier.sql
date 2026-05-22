-- Add the Scale tier between Team and Business.
--
-- The Team → Business cliff is 4× price ($499 → $1,999), 5× credits
-- (20K → 100K), and 20× chunks (500K → 10M). For customers in the
-- 500K–2M chunk band that's a forced over-payment and a common churn
-- moment. Scale fills the gap at $999 / 50K credits / 2M chunks, which
-- turns the upper ladder into clean 2× steps (Team × 2 = Scale, Scale
-- × 2 = Business).
--
-- Public from day one; new card on the landing page and a 5th tile on
-- /settings/billing. No grandfathering needed — this is purely additive.

INSERT INTO "billing_plans" (slug, name, monthly_credits, monthly_price_cents, features, is_public) VALUES
  ('scale', 'Scale', 50000, 99900,
   '{"maxConnectors":null, "syncIntervalTier":"standard", "sampleDataIncluded":true, "maxStoredChunks":2000000}'::jsonb,
   true);
