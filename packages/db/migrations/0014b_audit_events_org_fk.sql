ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id");
