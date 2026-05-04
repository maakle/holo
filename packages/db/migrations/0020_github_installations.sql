-- GitHub App installations.
--
-- Replaces the OAuth-app credential model for GitHub. An installation is
-- org-scoped (one row per holo org × GitHub installation). The worker mints
-- short-lived installation access tokens on demand from the App's private
-- key, so we never persist a long-lived secret here.
--
-- See: docs/decisions/0005-github-app-over-oauth.md
--      docs/designs/github-app-migration.md

CREATE TABLE IF NOT EXISTS "github_installations" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "installation_id"       bigint      NOT NULL,
  "account_login"         text        NOT NULL,
  "account_type"          text        NOT NULL,
  "account_id"            bigint      NOT NULL,
  "repository_selection"  text        NOT NULL,
  "installed_by_user_id"  uuid        REFERENCES "user"("id") ON DELETE SET NULL,
  "installed_at"          timestamptz NOT NULL DEFAULT now(),
  "suspended_at"          timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_org_install_uniq"
  ON "github_installations" ("organization_id", "installation_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "github_installations_install_idx"
  ON "github_installations" ("installation_id");
