import { holoError, ErrorCode } from '@holo/errors';
import {
  resolveCustomerAccountsForBatch,
  stripCustomerAccountHints,
} from '@holo/connectors';
import { computePath, hasPathFn } from '@holo/chunker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export type EmbeddingModel = 'openai-3-small' | 'openai-3-large' | 'voyage-code-3';

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
  //
  //    RFC 0009: compute a deterministic virtual-filesystem path per artifact
  //    from the first chunk's metadata, and denormalize the union of chunk
  //    acl_subjects onto the artifact row. HoloFs.readdir uses both to
  //    enforce ACLs without joining chunks.
  const artifactKeys = new Map<
    string,
    {
      organizationId: string;
      sourceId: string;
      kind: string;
      externalId: string;
      path: string | null;
      aclSubjects: Set<string>;
    }
  >();
  for (const e of embedded) {
    const key = `${e.chunk.sourceId}:${e.chunk.kind}:${e.chunk.sourceArtifactId}`;
    let entry = artifactKeys.get(key);
    if (!entry) {
      let path: string | null = null;
      if (hasPathFn(e.chunk.kind)) {
        try {
          path = computePath({
            kind: e.chunk.kind,
            externalId: e.chunk.sourceArtifactId,
            metadata: e.chunk.metadata ?? {},
          });
        } catch {
          // Defensive: a malformed metadata payload shouldn't fail the whole
          // batch. The artifact still upserts with path=NULL; the backfill
          // job picks it up later.
          path = null;
        }
      }
      entry = {
        organizationId: e.chunk.organizationId,
        sourceId: e.chunk.sourceId,
        kind: e.chunk.kind,
        externalId: e.chunk.sourceArtifactId,
        path,
        aclSubjects: new Set<string>(),
      };
      artifactKeys.set(key, entry);
    }
    for (const s of e.chunk.aclSubjects ?? []) entry.aclSubjects.add(s);
  }
  const artifactRows = [...artifactKeys.values()].map((a) => ({
    organization_id: a.organizationId,
    source_id: a.sourceId,
    external_id: a.externalId,
    kind: a.kind,
    payload: JSON.stringify({}),
    path: a.path,
    acl_subjects: [...a.aclSubjects],
  }));
  // One transaction wraps the artifact upsert, the customer_account resolves,
  // and the chunks insert. Before this was three separate auto-commits, which
  // is how the 2026-05-10 Google Chat / Drive ghost rows happened: 2,014
  // artifacts upserted, the embed/chunks step failed afterward, and the
  // half-written rows lingered until the path-backfill exposed them.
  return sql.begin(async (tx: Sql) => {
    const upserted = await tx<{ id: string; source_id: string; external_id: string }[]>`
      INSERT INTO source_artifacts ${tx(
        artifactRows,
        'organization_id',
        'source_id',
        'external_id',
        'kind',
        'payload',
        'path',
        'acl_subjects',
      )}
      ON CONFLICT (source_id, external_id) DO UPDATE SET
        fetched_at = NOW(),
        path = COALESCE(EXCLUDED.path, source_artifacts.path),
        acl_subjects = EXCLUDED.acl_subjects
      RETURNING id, source_id, external_id
    `;
    const artifactIdByKey = new Map<string, string>();
    for (const row of upserted) {
      artifactIdByKey.set(`${row.source_id}:${row.external_id}`, row.id);
    }

    // 2. Resolve customer_account stamps for every chunk. Connectors emit
    //    `customer_account_upsert` / `customer_account_hint` keys on metadata;
    //    the resolver upserts canonical rows (HubSpot company / Salesforce
    //    account / Pylon account) and looks up references from non-canonical
    //    chunks (deal, opportunity, ticket). One round-trip per identity kind
    //    across the whole batch — not per chunk.
    const accountResolutions = await resolveCustomerAccountsForBatch(
      tx,
      embedded.map((e) => ({
        organizationId: e.chunk.organizationId,
        metadata: e.chunk.metadata ?? null,
      })),
    );

    // 3. Insert chunks with the real source_artifacts UUID + resolved
    //    account_id. Hint keys are stripped from metadata — they're a
    //    transport convention, not durable data.
    const rows = embedded.map((e, i) => {
      const artifactId = artifactIdByKey.get(`${e.chunk.sourceId}:${e.chunk.sourceArtifactId}`);
      if (!artifactId) {
        // Should never happen: every embedded chunk had its key inserted above.
        throw holoError({
          code: ErrorCode.HOLO_INTERNAL,
          problem: `source_artifacts row missing for ${e.chunk.sourceArtifactId} after upsert`,
          fix: 'This is a worker bug — please report.',
        });
      }
      const cleanedMetadata = stripCustomerAccountHints(e.chunk.metadata ?? {});
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
        metadata: cleanedMetadata,
        account_id: accountResolutions[i]?.accountId ?? null,
      };
    });
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO chunks ${tx(
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
        'account_id',
      )}
      ON CONFLICT (organization_id, content_hash) DO NOTHING
      RETURNING id
    `;
    return inserted.length;
  });
}

function toPgVector(v: number[]): string {
  return `[${v.join(',')}]`;
}
