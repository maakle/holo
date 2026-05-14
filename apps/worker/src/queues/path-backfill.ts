/**
 * Path + ACL-subjects backfill for source_artifacts rows ingested before
 * migration 0047 (RFC 0009).
 *
 * For each source_artifacts row where `path IS NULL`, this:
 *   1. Looks at the row's chunks, picks the first one's metadata.
 *   2. Calls `computePath({ kind, externalId, metadata })` from @holo/chunker.
 *   3. UNIONs `acl_subjects` across all chunks of the artifact.
 *   4. UPDATEs the artifact row in one SQL round-trip per batch.
 *
 * Idempotent: rows already filled in by the worker's normal upsert path
 * (kinds with a registered path-fn) won't match `path IS NULL` and are
 * skipped. Kinds without a registered path-fn stay NULL and the operator
 * sees them in the summary so they can add a path-fn before re-running.
 *
 * One-shot CLI, not a BullMQ job — matches the account-backfill pattern.
 * Trigger via `apps/worker/scripts/backfill-paths.ts`.
 */
import { computePath, hasPathFn } from '@holo/chunker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export interface PathBackfillOptions {
  /** Max artifacts per pass. Default 500. */
  batchSize?: number;
  /** Stop after this many artifacts total. Default unbounded. */
  maxArtifacts?: number;
  /** Per-batch logger hook. */
  onBatch?: (stats: PathBackfillBatchStats) => void;
}

export interface PathBackfillBatchStats {
  /** Cumulative artifacts examined. */
  scanned: number;
  /** Cumulative artifacts whose path + ACLs were set. */
  filled: number;
  /** Cumulative artifacts skipped because no path-fn is registered for kind. */
  skippedUnknownKind: number;
  /** Cumulative artifacts skipped because chunk metadata was unusable. */
  skippedBadMetadata: number;
  /** Per-kind counts of artifacts skipped for missing path-fn. */
  unknownKinds: Record<string, number>;
}

export interface PathBackfillResult {
  totalScanned: number;
  totalFilled: number;
  totalSkippedUnknownKind: number;
  totalSkippedBadMetadata: number;
  unknownKinds: Record<string, number>;
}

interface ArtifactRow {
  id: string;
  organization_id: string;
  kind: string;
  external_id: string;
}

interface ChunkMetaRow {
  source_artifact_id: string;
  metadata: Record<string, unknown> | null;
  acl_subjects: string[] | null;
}

export async function runPathBackfill(
  sql: Sql,
  options: PathBackfillOptions = {},
): Promise<PathBackfillResult> {
  const batchSize = options.batchSize ?? 500;
  const maxArtifacts = options.maxArtifacts;

  let totalScanned = 0;
  let totalFilled = 0;
  let totalSkippedUnknownKind = 0;
  let totalSkippedBadMetadata = 0;
  const unknownKinds: Record<string, number> = {};

  // Keep an in-process cursor on (organization_id, id) so a crash mid-run
  // doesn't reprocess what we already filled. The WHERE path IS NULL filter
  // already excludes filled rows, but on retry it also excludes the rows
  // skipped this run (which would be infinite-loop without the cursor).
  let cursorOrg: string | null = null;
  let cursorId: string | null = null;

  while (true) {
    if (maxArtifacts !== undefined && totalScanned >= maxArtifacts) break;
    const remaining = maxArtifacts !== undefined
      ? Math.max(0, maxArtifacts - totalScanned)
      : batchSize;
    const take = Math.min(batchSize, remaining);
    if (take <= 0) break;

    const artifacts = (cursorOrg && cursorId
      ? await sql<ArtifactRow[]>`
          SELECT id, organization_id, kind, external_id
          FROM source_artifacts
          WHERE path IS NULL
            AND deleted_at IS NULL
            AND (organization_id, id) > (${cursorOrg}, ${cursorId})
          ORDER BY organization_id, id
          LIMIT ${take}
        `
      : await sql<ArtifactRow[]>`
          SELECT id, organization_id, kind, external_id
          FROM source_artifacts
          WHERE path IS NULL
            AND deleted_at IS NULL
          ORDER BY organization_id, id
          LIMIT ${take}
        `) as ArtifactRow[];

    if (artifacts.length === 0) break;

    // One IN query covers the whole batch's chunks. We only need one chunk's
    // metadata per artifact (artifact-level fields are shared), so we
    // dedupe by source_artifact_id below.
    const artifactIds = artifacts.map((a) => a.id);
    const chunkRows = (await sql<ChunkMetaRow[]>`
      SELECT source_artifact_id, metadata, acl_subjects
      FROM chunks
      WHERE source_artifact_id IN ${sql(artifactIds)}
    `) as ChunkMetaRow[];

    // Group: one representative metadata per artifact + ACL union.
    const byArtifact = new Map<
      string,
      { metadata: Record<string, unknown>; aclUnion: Set<string> }
    >();
    for (const c of chunkRows) {
      let entry = byArtifact.get(c.source_artifact_id);
      if (!entry) {
        entry = {
          metadata: c.metadata ?? {},
          aclUnion: new Set<string>(),
        };
        byArtifact.set(c.source_artifact_id, entry);
      }
      for (const s of c.acl_subjects ?? []) entry.aclUnion.add(s);
    }

    const updates: { id: string; path: string; aclSubjects: string[] }[] = [];

    for (const a of artifacts) {
      totalScanned += 1;
      if (!hasPathFn(a.kind)) {
        totalSkippedUnknownKind += 1;
        unknownKinds[a.kind] = (unknownKinds[a.kind] ?? 0) + 1;
        continue;
      }
      const group = byArtifact.get(a.id);
      if (!group) {
        // Artifact with no chunks (shouldn't happen but possible after a
        // failed embed). Skip — backfill will pick it up on a later run
        // once chunks exist; for now ACL stays empty.
        totalSkippedBadMetadata += 1;
        continue;
      }
      try {
        const path = computePath({
          kind: a.kind,
          externalId: a.external_id,
          metadata: group.metadata,
        });
        updates.push({
          id: a.id,
          path,
          aclSubjects: [...group.aclUnion],
        });
      } catch {
        totalSkippedBadMetadata += 1;
      }
    }

    if (updates.length > 0) {
      // Bulk UPDATE via jsonb_to_recordset — one round-trip per batch.
      // UNNEST flattens text[][] to text, so jagged ACL arrays go through
      // JSON instead, where text[] is a first-class recordset column type.
      const payload = updates.map((u) => ({
        id: u.id,
        path: u.path,
        acl_subjects: u.aclSubjects,
      }));
      await sql`
        UPDATE source_artifacts AS sa
        SET path = u.path,
            acl_subjects = u.acl_subjects
        FROM jsonb_to_recordset(${sql.json(payload)})
          AS u(id uuid, path text, acl_subjects text[])
        WHERE sa.id = u.id
      `;
      totalFilled += updates.length;
    }

    const last = artifacts[artifacts.length - 1];
    if (!last) break;
    cursorOrg = last.organization_id;
    cursorId = last.id;

    options.onBatch?.({
      scanned: totalScanned,
      filled: totalFilled,
      skippedUnknownKind: totalSkippedUnknownKind,
      skippedBadMetadata: totalSkippedBadMetadata,
      unknownKinds: { ...unknownKinds },
    });

    if (artifacts.length < take) break;
  }

  return {
    totalScanned,
    totalFilled,
    totalSkippedUnknownKind,
    totalSkippedBadMetadata,
    unknownKinds,
  };
}
