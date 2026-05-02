CREATE TABLE IF NOT EXISTS "oauth_auth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_clients"("client_id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "redirect_uri" text NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "code_challenge" text NOT NULL,
  "code_challenge_method" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_auth_codes_code_uniq" ON "oauth_auth_codes" ("code");
CREATE INDEX IF NOT EXISTS "oauth_auth_codes_expires_at_idx" ON "oauth_auth_codes" ("expires_at");

CREATE TABLE IF NOT EXISTS "oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_clients"("client_id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "scopes" text[] NOT NULL DEFAULT '{}',
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_access_tokens_token_hash_uniq" ON "oauth_access_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "oauth_access_tokens_user_expires_idx" ON "oauth_access_tokens" ("user_id", "expires_at");

CREATE TABLE IF NOT EXISTS "slack_user_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "slack_user_id" text NOT NULL,
  "access_token_encrypted" text NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "connected_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "slack_user_credentials_user_id_uniq" ON "slack_user_credentials" ("user_id");
CREATE INDEX IF NOT EXISTS "slack_user_credentials_org_idx" ON "slack_user_credentials" ("organization_id");

CREATE TABLE IF NOT EXISTS "user_subjects_cache" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "subject" text NOT NULL,
  "source" text NOT NULL,
  "refreshed_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_subjects_cache_user_subject_uniq" ON "user_subjects_cache" ("user_id", "subject");
CREATE INDEX IF NOT EXISTS "user_subjects_cache_user_idx" ON "user_subjects_cache" ("user_id");
