-- Promote chunks(organization_id, content_hash) to a UNIQUE index so the
-- embed worker can `INSERT ... ON CONFLICT (organization_id, content_hash)
-- DO NOTHING` to make checkpoint-replay re-embeds idempotent.
DROP INDEX IF EXISTS "chunks_content_hash_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "chunks_content_hash_idx"
  ON "chunks" ("organization_id", "content_hash");
