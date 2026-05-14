-- Closed-beta allowlist. While the hosted product is invite-only, signups
-- (first OAuth login or first email-OTP verification) are rejected unless
-- the email is present in this table. Empty table = "anyone can sign up"
-- behavior is gated by the AUTH_ALLOWLIST_ENABLED env flag, not by row count
-- (so we don't accidentally throw the doors open by truncating).
--
-- Operationally: add new beta users via SQL until volume justifies an admin UI.
--   insert into allowed_signup_emails (email) values ('user@example.com');
CREATE TABLE "allowed_signup_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
