ALTER TABLE "source_artifacts" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "source_artifacts" ADD COLUMN "acl_subjects" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "source_artifacts_org_path_idx" ON "source_artifacts" USING btree ("organization_id","path") WHERE "source_artifacts"."path" IS NOT NULL AND "source_artifacts"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "source_artifacts_acl_subjects_gin_idx" ON "source_artifacts" USING gin ("acl_subjects");
