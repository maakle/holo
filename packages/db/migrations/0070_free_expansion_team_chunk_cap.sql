-- Pricing model v3 — Free expansion + Team chunk-cap tightening.
--
-- Two changes that move ARR in opposite directions and one direction overall:
--
-- 1. Free plan: 1 → 2 connectors, 10K → 25K stored chunks. Strictly more
--    generous to existing Free users — UPDATE in place, no grandfathering
--    needed. Loosens the trial gate so people can actually evaluate
--    multi-source RAG before paying.
--
-- 2. Team plan: stored-chunk cap tightened from 1M → 500K. Pushes data-heavy
--    customers from Team ($499/mo) toward Business ($1,999/mo) earlier in
--    their growth curve, which is where the model under-monetizes today.
--    Uses the same rename-and-replace grandfather mechanic from migration
--    0061: existing Team subscriptions reference billing_plans by UUID, so
--    renaming the current row to `team-legacy-2026-05-v2` (and marking it
--    non-public) leaves their cap at 1M. New signups land on the fresh
--    `team` row at the 500K cap.
--
-- Stripe Price IDs are unchanged. The legacy Team row keeps the same
-- monthly_price_cents and monthly_credits as the current Team row, so
-- existing subscriptions continue to bill identically.

-- 1. Free expansion (in place — strictly beneficial)
UPDATE "billing_plans"
SET features = features || jsonb_build_object('maxConnectors', 2, 'maxStoredChunks', 25000)
WHERE slug = 'free';
--> statement-breakpoint

-- 2. Team tightening (grandfather, mirrors migration 0061)
UPDATE "billing_plans"
SET slug = 'team-legacy-2026-05-v2', is_public = false
WHERE slug = 'team';
--> statement-breakpoint

INSERT INTO "billing_plans" (slug, name, monthly_credits, monthly_price_cents, features, is_public) VALUES
  ('team', 'Team', 20000, 49900,
   '{"maxConnectors":null, "syncIntervalTier":"standard", "sampleDataIncluded":true, "maxStoredChunks":500000}'::jsonb,
   true);
