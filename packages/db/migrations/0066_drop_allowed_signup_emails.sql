-- Drop the closed-beta signup allowlist. Now that billing/payment is wired
-- up, signups are open and gated by the paywall instead of an invite list.
-- The `allowed_signup_emails` table and the `HOLO_SIGNUP_ALLOWLIST_ENABLED`
-- env flag are gone; this migration removes the table behind them.

DROP TABLE IF EXISTS "allowed_signup_emails";
