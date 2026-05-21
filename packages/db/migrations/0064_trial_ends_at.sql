-- 14-day free trial mechanic (RFC 0010 / ADR 0007 — W3 / M2).
--
-- Add `trial_ends_at` to `organization_subscriptions`. New signups will get
-- `now() + 14 days` set by `seedInitialSubscriptionAndGrant`; this migration
-- only adds the column and backfills existing orgs to NULL (= grandfathered,
-- no trial expiry — they keep the legacy forever-free tier indefinitely).
--
-- Trial-expired state is derived (not stored): when
-- `trial_ends_at` IS NOT NULL AND `trial_ends_at` < now() AND no Stripe
-- subscription exists, the org's pool stops refilling and the existing
-- pool-exhaustion guard (B4) blocks new operations once credits run out.

ALTER TABLE "organization_subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;
