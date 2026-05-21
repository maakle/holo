-- Full credit-unit normalization (RFC 0010 / ADR 0007 — follow-up to 0063).
--
-- 0063 divided `credit_prices.credits_per_unit` by 100 so per-chat cost
-- dropped to ~200 credits, but it left plan grants, top-up packages, and the
-- historical ledger at the old big magnitude. Net UX: per-chat looked small
-- (~200) but Team still said "2M credits / month" and balances stayed in
-- the millions — the psychological point of redenomination didn't land.
--
-- This migration finishes the job: divide every credit-denominated column
-- by 100 consistently. After applying:
--
--   - credit_prices.credits_per_unit: total /10000 from original
--     (Sonnet input: 400 → 0.04 per 1K tokens; output: 1950 → 0.195)
--   - billing_plans.monthly_credits: Free 25K → 250, Starter 250K → 2.5K,
--     Team 2M → 20K, Business 10M → 100K (Enterprise stays at 0)
--   - credit_topup_packages.credits: Small 200K → 2K, Medium 1M → 10K,
--     Large 3M → 30K
--   - credit_ledger.credits: every historical row /100 (positive grants and
--     negative debits alike). Ledger is normally append-only, but a unit
--     change requires a one-time rewrite to keep balance math coherent —
--     this is the documented exception.
--
-- Stripe dollar prices are NOT changed: customers still pay $99 / $499 /
-- $1999 monthly and $50 / $200 / $500 for top-ups. Only the credit unit
-- shrinks.
--
-- Tradeoff: per-chat cost loses some granularity at this scale because
-- `Math.ceil` in pricing.ts floors each token bucket to ≥1 credit. Small and
-- moderate chats both round to ~2–3 credits; heavy chats still cost more
-- (e.g. 200K input + 100K output ≈ 28 credits). RFC chat-count promises
-- (Team = 10K chats/mo) hold within ~30% depending on average chat size.

-- 1. Per-call pricing
UPDATE "credit_prices" SET credits_per_unit = credits_per_unit / 100;
--> statement-breakpoint

-- 2. Plan monthly grants (Enterprise stays at 0; 0/100 = 0, safe)
UPDATE "billing_plans" SET monthly_credits = monthly_credits / 100;
--> statement-breakpoint

-- 3. Top-up package sizes (Stripe `price_cents` untouched)
UPDATE "credit_topup_packages" SET credits = credits / 100;
--> statement-breakpoint

-- 4. Historical ledger. Integer division truncates toward zero — fine for
-- both positive (grants/topups/refunds) and negative (debits/expiries)
-- rows. Sub-100-credit rows collapse to 0; rare and benign because
-- pre-redenom debits were never small.
UPDATE "credit_ledger" SET credits = (credits / 100)::bigint;
