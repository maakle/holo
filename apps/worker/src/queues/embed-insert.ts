// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export type EmbeddingModel = 'openai-3-large' | 'voyage-code-3';

export type ChunkInsertPayload = {
  // Routing fields used by the embedder (kind drives prose vs code).
  kind: string;
  content: string;
  metadata?: Record<string, unknown>;
  aclSubjects?: string[];
  // Identity + ACL fields populated by the connector before enqueueing.
  organizationId: string;
  sourceId: string;
  sourceArtifactId: string;
  provider: string;
  contentHash: string;
};

export type EmbeddedChunkRow = {
  chunk: ChunkInsertPayload;
  embedding: number[];
  embeddingModel: EmbeddingModel;
};

export type EmbedJobPayload = {
  chunks: ChunkInsertPayload[];
  organizationId: string;
  sourceArtifactId: string;
};

// Bulk-insert embedded chunks. ON CONFLICT (organization_id, content_hash)
// DO NOTHING so re-embedding the same chunk after a checkpoint replay is a
// no-op. Returns the number of newly inserted rows.
export async function insertEmbeddedChunks(
  sql: Sql,
  embedded: EmbeddedChunkRow[],
): Promise<number> {
  if (embedded.length === 0) return 0;

  // postgres.js multi-row insert via the helper sql(rows, ...cols).
  // ON CONFLICT (organization_id, content_hash) DO NOTHING makes re-embedding
  // the same chunk a no-op (idempotent under checkpoint replay).
  const rows = embedded.map((e) => ({
    organization_id: e.chunk.organizationId,
    source_artifact_id: e.chunk.sourceArtifactId,
    source_id: e.chunk.sourceId,
    provider: e.chunk.provider,
    kind: e.chunk.kind,
    content: e.chunk.content,
    content_hash: e.chunk.contentHash,
    embedding_model: e.embeddingModel,
    embedding: toPgVector(e.embedding),
    acl_subjects: e.chunk.aclSubjects ?? [],
    metadata: JSON.stringify(e.chunk.metadata ?? {}),
  }));
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO chunks ${sql(
      rows,
      'organization_id',
      'source_artifact_id',
      'source_id',
      'provider',
      'kind',
      'content',
      'content_hash',
      'embedding_model',
      'embedding',
      'acl_subjects',
      'metadata',
    )}
    ON CONFLICT (organization_id, content_hash) DO NOTHING
    RETURNING id
  `;
  return inserted.length;
}

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}
