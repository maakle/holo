CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "token_hash" text NOT NULL UNIQUE,
  "label" text NOT NULL DEFAULT 'default',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "api_tokens_org_user_idx" ON "api_tokens" ("organization_id", "user_id");
