import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface ChunkRow {
  id: string;
  organizationId: string;
  sourceArtifactId: string;
  kind: string;
  content: string;
  contentHash: string;
  embeddingModel: string;
  metadata: Record<string, unknown>;
  provider: string;
  sourceId: string;
  createdAt: Date;
}

export interface GetArtifactInput {
  db: DB;
  artifactId: string;
  organizationId: string;
}

export interface GetArtifactResult {
  chunks: ChunkRow[];
  ordered: ChunkRow[];
  artifactKind: string;
}

interface RawRow {
  id: string;
  organization_id: string;
  source_artifact_id: string;
  kind: string;
  content: string;
  content_hash: string;
  embedding_model: string;
  metadata: Record<string, unknown> | null;
  provider: string;
  source_id: string;
  created_at: Date | string;
  artifact_kind: string;
}

function toCamel(r: RawRow): ChunkRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    sourceArtifactId: r.source_artifact_id,
    kind: r.kind,
    content: r.content,
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    provider: r.provider,
    sourceId: r.source_id,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  };
}

function compareLex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderChunks(chunks: ChunkRow[], artifactKind: string): ChunkRow[] {
  const sorted = [...chunks];

  switch (artifactKind) {
    case 'pr': {
      // title → diff → review; within each, position ?? 0.
      const order = ['title', 'diff', 'review'];
      sorted.sort((a, b) => {
        const ka = order.indexOf(String(a.metadata['kind']));
        const kb = order.indexOf(String(b.metadata['kind']));
        if (ka !== kb) return ka - kb;
        const pa = Number(a.metadata['position'] ?? 0);
        const pb = Number(b.metadata['position'] ?? 0);
        return pa - pb;
      });
      return sorted;
    }
    case 'doc': {
      sorted.sort((a, b) => {
        const ia = Number(a.metadata['chunk_index'] ?? 0);
        const ib = Number(b.metadata['chunk_index'] ?? 0);
        return ia - ib;
      });
      return sorted;
    }
    case 'thread': {
      sorted.sort((a, b) => {
        const ta = String(a.metadata['ts'] ?? '');
        const tb = String(b.metadata['ts'] ?? '');
        return compareLex(ta, tb);
      });
      return sorted;
    }
    case 'notion-page': {
      sorted.sort((a, b) => {
        const ka = String(a.metadata['kind'] ?? '');
        const kb = String(b.metadata['kind'] ?? '');
        if (ka === 'page' && kb !== 'page') return -1;
        if (kb === 'page' && ka !== 'page') return 1;
        return compareLex(String(a.metadata['block_id'] ?? ''), String(b.metadata['block_id'] ?? ''));
      });
      return sorted;
    }
    default:
      return sorted;
  }
}

export async function getArtifact(input: GetArtifactInput): Promise<GetArtifactResult> {
  const result = await input.db.execute<RawRow & Record<string, unknown>>(sql`
    SELECT c.*, sa.kind AS artifact_kind
    FROM chunks c
    JOIN source_artifacts sa ON sa.id = c.source_artifact_id
    WHERE c.source_artifact_id = ${input.artifactId}
      AND c.organization_id = ${input.organizationId}
  `);

  const rawRows = ((result as unknown as { rows?: RawRow[] }).rows
    ?? (result as unknown as RawRow[])) ?? [];

  if (rawRows.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
      problem: `No chunks found for artifact ${input.artifactId}`,
      cause: `organizationId=${input.organizationId}`,
      fix: 'Verify the artifact id is correct and the org has access.',
    });
  }

  const artifactKind = String(rawRows[0]!.artifact_kind);
  const chunks = rawRows.map(toCamel);
  const ordered = orderChunks(chunks, artifactKind);

  return { chunks, ordered, artifactKind };
}
