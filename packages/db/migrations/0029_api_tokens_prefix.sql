-- Store a short non-secret prefix of the raw token at creation time so the
-- Settings UI can render a recognizable, partly-redacted identifier (e.g.
-- `holo_a1b2c3…`) for each token. Pre-existing rows stay NULL — the UI falls
-- back to the label for those.

ALTER TABLE "api_tokens"
  ADD COLUMN IF NOT EXISTS "token_prefix" text;
