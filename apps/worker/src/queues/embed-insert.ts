import { holoError, ErrorCode } from '@holo/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export type EmbeddingModel = 'openai-3-small' | 'voyage-code-3';

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
//
// Connectors emit `chunk.sourceArtifactId` as a *synthetic external id*
// (e.g. "github-pr:owner/repo#1234") because they don't know the
// source_artifacts row's UUID — that table is owned by the worker. Before
// inserting chunks (whose source_artifact_id is a UUID FK), this function
// upserts a source_artifacts row per (sourceId, kind, externalId) tuple
// and substitutes the resulting UUID into each chunk row.
export async function insertEmbeddedChunks(
  sql: Sql,
  embedded: EmbeddedChunkRow[],
): Promise<number> {
  if (embedded.length === 0) return 0;

  // 1. Upsert source_artifacts. Group chunks by (sourceId, kind, externalId)
  //    so we don't hit the same row repeatedly within one batch.
  const artifactKeys = new Map<
    string,
    { organizationId: string; sourceId: string; kind: string; externalId: string }
  >();
  for (const e of embedded) {
    const key = `${e.chunk.sourceId}:${e.chunk.kind}:${e.chunk.sourceArtifactId}`;
    if (!artifactKeys.has(key)) {
      artifactKeys.set(key, {
        organizationId: e.chunk.organizationId,
        sourceId: e.chunk.sourceId,
        kind: e.chunk.kind,
        externalId: e.chunk.sourceArtifactId,
      });
    }
  }
  const artifactRows = [...artifactKeys.values()].map((a) => ({
    organization_id: a.organizationId,
    source_id: a.sourceId,
    external_id: a.externalId,
    kind: a.kind,
    payload: JSON.stringify({}),
  }));
  const upserted = await sql<{ id: string; source_id: string; external_id: string }[]>`
    INSERT INTO source_artifacts ${sql(
      artifactRows,
      'organization_id',
      'source_id',
      'external_id',
      'kind',
      'payload',
    )}
    ON CONFLICT (source_id, external_id) DO UPDATE SET fetched_at = NOW()
    RETURNING id, source_id, external_id
  `;
  const artifactIdByKey = new Map<string, string>();
  for (const row of upserted) {
    artifactIdByKey.set(`${row.source_id}:${row.external_id}`, row.id);
  }

  // 2. Insert chunks with the real source_artifacts UUID.
  const rows = embedded.map((e) => {
    const artifactId = artifactIdByKey.get(`${e.chunk.sourceId}:${e.chunk.sourceArtifactId}`);
    if (!artifactId) {
      // Should never happen: every embedded chunk had its key inserted above.
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `source_artifacts row missing for ${e.chunk.sourceArtifactId} after upsert`,
        fix: 'This is a worker bug — please report.',
      });
    }
    return {
      organization_id: e.chunk.organizationId,
      source_artifact_id: artifactId,
      source_id: e.chunk.sourceId,
      provider: e.chunk.provider,
      kind: e.chunk.kind,
      content: e.chunk.content,
      content_hash: e.chunk.contentHash,
      embedding_model: e.embeddingModel,
      embedding: toPgVector(e.embedding),
      acl_subjects: e.chunk.aclSubjects ?? [],
      metadata: JSON.stringify(e.chunk.metadata ?? {}),
    };
  });
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
