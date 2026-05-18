-- Add auth_mode to connector_service_accounts: distinguishes domain-wide
-- delegation (current default) from app-level Chat bot auth (new, narrower
-- trust grant). app mode skips user impersonation, so impersonation_email
-- becomes optional. See docs/designs/google-chat-bot-in-space-migration.md.

ALTER TABLE "connector_service_accounts"
  ADD COLUMN "auth_mode" text NOT NULL DEFAULT 'dwd';

ALTER TABLE "connector_service_accounts"
  ADD CONSTRAINT "connector_service_accounts_auth_mode_check"
  CHECK ("auth_mode" IN ('dwd', 'app'));

ALTER TABLE "connector_service_accounts"
  ALTER COLUMN "impersonation_email" DROP NOT NULL;
