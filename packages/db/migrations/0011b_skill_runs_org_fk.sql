ALTER TABLE "skill_runs"
  ADD CONSTRAINT "skill_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organization"("id");
