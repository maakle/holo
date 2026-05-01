CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- Backfill any pre-existing rows so the NOT NULL add can succeed.
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "content_hash" text;
--> statement-breakpoint

UPDATE "chunks"
   SET "content_hash" = encode(digest(coalesce("kind",'') || ':' || coalesce("content",''), 'sha256'), 'hex')
 WHERE "content_hash" IS NULL;
--> statement-breakpoint

ALTER TABLE "chunks" ALTER COLUMN "content_hash" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "chunks"
  ADD COLUMN IF NOT EXISTS "embedding_model" text NOT NULL DEFAULT 'openai-3-large';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chunks_content_hash_idx"
  ON "chunks" ("organization_id", "content_hash");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "chunks_metadata_pr_idx"
  ON "chunks" USING GIN ("metadata" jsonb_path_ops);
