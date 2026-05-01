CREATE TABLE IF NOT EXISTS "oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "client_id" text NOT NULL,
  "client_name" text NOT NULL,
  "redirect_uris" text[] NOT NULL DEFAULT '{}',
  "scopes" text[] NOT NULL DEFAULT '{}',
  "registered_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_clients_client_id_uniq" ON "oauth_clients" ("client_id");
CREATE INDEX IF NOT EXISTS "oauth_clients_org_idx" ON "oauth_clients" ("organization_id");
