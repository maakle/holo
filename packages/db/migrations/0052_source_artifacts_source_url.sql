-- RFC 0009 follow-up: denormalize the source-system URL onto every artifact.
--
-- Today the agent's `bash` tool returns paths from a virtual filesystem;
-- when those paths get extracted as citations, they point at the dashboard
-- `/files/<path>` view. To give agents real source-system links (slack
-- thread URL, github PR URL, notion page URL, stripe dashboard URL, etc.)
-- without per-call metadata reconstruction, we stamp the URL once at
-- embed-insert time and look it up by path on demand.
--
-- Nullable on purpose: not every kind has a derivable URL (salesforce,
-- some hubspot record types, custom connectors that don't expose a
-- canonical link). Citation extractors fall back to /files/<path> when
-- source_url is NULL.
--
-- Partial index covers the common access pattern (lookup by path within
-- an org, only for rows that actually have a URL).
ALTER TABLE "source_artifacts" ADD COLUMN "source_url" text;--> statement-breakpoint
CREATE INDEX "source_artifacts_org_path_with_url_idx"
  ON "source_artifacts" USING btree ("organization_id", "path")
  WHERE "source_url" IS NOT NULL AND "deleted_at" IS NULL;
