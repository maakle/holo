-- Required extension for vector ops
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW for cosine similarity on embeddings (created on empty table — instant)
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN on tsvector for BM25-via-tsquery
CREATE INDEX IF NOT EXISTS chunks_content_tsvector_gin_idx
  ON chunks USING gin (content_tsvector);

-- GIN on text array for ACL subject filtering
CREATE INDEX IF NOT EXISTS chunks_acl_subjects_gin_idx
  ON chunks USING gin (acl_subjects);

-- Trigger to populate content_tsvector on INSERT/UPDATE (English config; revisit at v0.2 for multi-lang)
CREATE OR REPLACE FUNCTION chunks_content_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.content_tsvector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_content_tsv_trg ON chunks;
CREATE TRIGGER chunks_content_tsv_trg
  BEFORE INSERT OR UPDATE OF content ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_content_tsv_trigger();
