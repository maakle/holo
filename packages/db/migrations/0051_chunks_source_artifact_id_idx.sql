-- Index chunks(source_artifact_id) — the FK doesn't auto-create one.
--
-- Hot paths that filter chunks by source_artifact_id:
--   - HoloFs.readFile (chunk fetch per artifact)
--   - /api/files enrichment LATERAL SUM(octet_length(content)) per artifact,
--     which fans out across every artifact under the prefix. At path = '/'
--     that's every artifact in the org, and without this index each LATERAL
--     iteration falls back to the GIN acl_subjects index or a seq scan.
--
CREATE INDEX IF NOT EXISTS "chunks_source_artifact_id_idx"
  ON "chunks" USING btree ("source_artifact_id");
