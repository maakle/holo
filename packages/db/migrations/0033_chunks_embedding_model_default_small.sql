-- Switch the chunks.embedding_model default to 'openai-3-small'. New chunks
-- inserted by the chunkers set this column explicitly, so the default is a
-- safety net — it should still reflect the current model. Existing rows
-- tagged 'openai-3-large' are NOT touched here; they're rewritten by the
-- backfill in PR #129.
ALTER TABLE "chunks" ALTER COLUMN "embedding_model" SET DEFAULT 'openai-3-small';
