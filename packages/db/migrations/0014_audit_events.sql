CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid REFERENCES "user"("id"),
  "event_type" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "meta" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_events_org_created_at_idx" ON "audit_events" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx" ON "audit_events" ("organization_id", "event_type");
