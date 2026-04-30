CREATE TABLE IF NOT EXISTS "connector_allowlists" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "provider"        text NOT NULL,
  "pattern"         text NOT NULL,
  "pattern_kind"    text NOT NULL,
  "decision"        text NOT NULL DEFAULT 'include',
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "created_by"      uuid NOT NULL REFERENCES "user"("id"),
  "notes"           text
);

CREATE INDEX IF NOT EXISTS "connector_allowlists_org_provider_idx"
  ON "connector_allowlists" ("organization_id", "provider");
