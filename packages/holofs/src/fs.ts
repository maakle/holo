/**
 * HoloFs — virtual filesystem over the Holo context layer. RFC 0009.
 *
 * Implements just-bash's `IFileSystem` interface against Postgres (chunks +
 * source_artifacts). Read-only: writes throw `EROFS`. ACL enforcement on
 * every read, using the denormalized `source_artifacts.acl_subjects`
 * column (filled by the worker's embed-insert and the path-backfill job —
 * see RFC 0009 Phase 1).
 *
 * Defense in depth:
 *   - readFile re-checks ACL at the *chunk* level, so a chunk with
 *     narrower ACL than its parent artifact is never surfaced.
 *   - Path parser rejects `..`, control characters, and non-absolute
 *     paths before any SQL runs.
 *   - All SQL is parameterized via drizzle's template literals.
 *
 * Not depended on by `just-bash` directly — the bash MCP tool in
 * @holo/agent-tools imports both packages and wires HoloFs into a
 * `new Bash({ fs })` instance. just-bash sees this object structurally.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { ENOENT, ENOTDIR, EROFS } from './errors';
import { asDirPrefix, basename, nextSegmentAfter, normalizePath } from './path';
import { renderArtifact, type ChunkLike } from './render';

export interface HoloFsDeps {
  db: DB;
  organizationId: string;
  /**
   * Resolved ACL subjects for the caller — `[ 'org:{orgId}',
   * 'slack-channel:C012', 'notion-page-tree:abc' ]`. The MCP gateway
   * resolves these from the session before constructing HoloFs; the
   * dashboard's file-explorer endpoints do the same for the signed-in
   * user. This is the security-critical input. An empty array means
   * "see nothing"; a privileged caller (e.g. an internal job) gets
   * the broadest set of subjects the user can prove possession of.
   */
  userSubjects: string[];
}

export interface DirEntry {
  /** Single segment, no slashes. */
  name: string;
  /** 'directory' = next segment of a deeper path; 'file' = a leaf artifact. */
  type: 'file' | 'directory';
}

export interface Stat {
  type: 'file' | 'directory';
  path: string;
  /** Only set on files: the source_artifact UUID. Useful for downstream
   * tools that want to bypass HoloFs and go straight to the DB. */
  artifactId?: string;
  /** Source-system kind (e.g. 'slack-thread'). Only set on files. */
  kind?: string;
  /** Size in characters of the rendered file. NULL on directories. */
  size?: number;
  /** Last update time of the underlying artifact. */
  updatedAt?: Date;
}

type ChunkRow = {
  source_artifact_id: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  acl_subjects: string[];
};

function formatTextArray(values: string[]): string {
  const escaped = values.map(
    (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(',')}}`;
}

function unwrapRows<T>(result: unknown): T[] {
  const r = result as { rows?: T[] } | T[];
  if (Array.isArray(r)) return r;
  return r.rows ?? [];
}

export class HoloFs {
  private readonly db: DB;
  private readonly organizationId: string;
  private readonly userSubjects: string[];

  constructor(deps: HoloFsDeps) {
    this.db = deps.db;
    this.organizationId = deps.organizationId;
    this.userSubjects = [...deps.userSubjects];
  }

  // --- reads --------------------------------------------------------------

  async readdir(path: string): Promise<DirEntry[]> {
    const dirPrefix = asDirPrefix(path);
    // Empty userSubjects => array && empty = false => no rows. Postgres is
    // happy with the empty array literal '{}'.
    const aclLiteral = formatTextArray(this.userSubjects);

    // Single SQL: pick every artifact under the prefix the user can see, and
    // emit the next segment. Distinct + a marker for whether it's a
    // terminal leaf (artifact path exactly = prefix + segment) or a deeper
    // directory.
    const result = await this.db.execute<{
      name: string;
      kind: 'file' | 'directory';
    }>(sql`
      WITH visible AS (
        SELECT path
        FROM source_artifacts
        WHERE organization_id = ${this.organizationId}
          AND path IS NOT NULL
          AND deleted_at IS NULL
          AND path LIKE ${dirPrefix + '%'}
          AND acl_subjects && ${aclLiteral}::text[]
      )
      SELECT name, MIN(kind) AS kind
      FROM (
        SELECT
          CASE
            WHEN position('/' IN substring(path, ${dirPrefix.length + 1})) = 0
              THEN substring(path, ${dirPrefix.length + 1})
            ELSE substring(
              path,
              ${dirPrefix.length + 1},
              position('/' IN substring(path, ${dirPrefix.length + 1})) - 1
            )
          END AS name,
          CASE
            WHEN position('/' IN substring(path, ${dirPrefix.length + 1})) = 0
              THEN 'file' ELSE 'directory'
          END AS kind
        FROM visible
      ) seg
      WHERE name <> ''
      GROUP BY name
      ORDER BY name
    `);

    return unwrapRows<{ name: string; kind: 'file' | 'directory' }>(result).map((r) => ({
      name: r.name,
      type: r.kind,
    }));
  }

  async stat(path: string): Promise<Stat> {
    const norm = normalizePath(path);
    if (norm === '/') {
      return { type: 'directory', path: '/' };
    }
    const aclLiteral = formatTextArray(this.userSubjects);

    // Exact-match file?
    const fileResult = await this.db.execute<{
      id: string;
      kind: string;
      fetched_at: Date | string;
    }>(sql`
      SELECT id, kind, fetched_at
      FROM source_artifacts
      WHERE organization_id = ${this.organizationId}
        AND path = ${norm}
        AND deleted_at IS NULL
        AND acl_subjects && ${aclLiteral}::text[]
      LIMIT 1
    `);
    const fileRow = unwrapRows<{ id: string; kind: string; fetched_at: Date | string }>(
      fileResult,
    )[0];
    if (fileRow) {
      // Size = rendered length; cheaper to compute lazily on cat than per stat.
      // We omit it here unless the caller calls readFile.
      return {
        type: 'file',
        path: norm,
        artifactId: fileRow.id,
        kind: fileRow.kind,
        updatedAt:
          fileRow.fetched_at instanceof Date
            ? fileRow.fetched_at
            : new Date(fileRow.fetched_at),
      };
    }

    // Directory prefix?
    const dirPrefix = asDirPrefix(norm);
    const dirResult = await this.db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM source_artifacts
        WHERE organization_id = ${this.organizationId}
          AND path LIKE ${dirPrefix + '%'}
          AND deleted_at IS NULL
          AND acl_subjects && ${aclLiteral}::text[]
      ) AS exists
    `);
    const dirRow = unwrapRows<{ exists: boolean }>(dirResult)[0];
    if (dirRow?.exists) {
      return { type: 'directory', path: norm };
    }

    throw ENOENT(norm);
  }

  async readFile(path: string): Promise<string> {
    const norm = normalizePath(path);
    if (norm === '/') {
      throw ENOTDIR(norm);
    }
    const aclLiteral = formatTextArray(this.userSubjects);

    // 1. Look up the artifact, checking artifact-level ACL.
    const artifactResult = await this.db.execute<{ id: string; kind: string }>(sql`
      SELECT id, kind
      FROM source_artifacts
      WHERE organization_id = ${this.organizationId}
        AND path = ${norm}
        AND deleted_at IS NULL
        AND acl_subjects && ${aclLiteral}::text[]
      LIMIT 1
    `);
    const artifactRow = unwrapRows<{ id: string; kind: string }>(artifactResult)[0];
    if (!artifactRow) throw ENOENT(norm);

    // 2. Fetch chunks. We pull BOTH visible and total counts in one query so
    //    the renderer can surface a `[redacted N chunks]` marker.
    const totalResult = await this.db.execute<{ total: string | number }>(sql`
      SELECT count(*)::int AS total
      FROM chunks
      WHERE source_artifact_id = ${artifactRow.id}
    `);
    const totalRow = unwrapRows<{ total: string | number }>(totalResult)[0];
    const total = Number(totalRow?.total ?? 0);

    const chunkResult = await this.db.execute<ChunkRow>(sql`
      SELECT source_artifact_id, kind, content, metadata, created_at, acl_subjects
      FROM chunks
      WHERE source_artifact_id = ${artifactRow.id}
        AND acl_subjects && ${aclLiteral}::text[]
      ORDER BY
        COALESCE((metadata->>'chunk_index')::int, 0),
        created_at
    `);
    const visibleChunks = unwrapRows<ChunkRow>(chunkResult);

    const chunkLikes: ChunkLike[] = visibleChunks.map((c) => ({
      kind: c.kind,
      content: c.content,
      metadata: c.metadata,
      createdAt: c.created_at,
    }));

    if (chunkLikes.length === 0) {
      // Artifact exists at the artifact level but no chunks are visible
      // to the user. Treat as "not found" rather than leaking the
      // existence of an empty (forbidden) artifact.
      if (total > 0) throw ENOENT(norm);
      return '';
    }

    const { content } = renderArtifact(artifactRow.kind, chunkLikes, total);
    return content;
  }

  // --- writes (always throw) ---------------------------------------------

  async writeFile(path: string): Promise<void> {
    throw EROFS(path);
  }
  async mkdir(path: string): Promise<void> {
    throw EROFS(path);
  }
  async unlink(path: string): Promise<void> {
    throw EROFS(path);
  }
  async rmdir(path: string): Promise<void> {
    throw EROFS(path);
  }
  async rename(from: string): Promise<void> {
    throw EROFS(from);
  }

  // --- introspection (used by the file-explorer UI) ----------------------

  /**
   * Return the names AND types of immediate children of `path`. Sugar over
   * `readdir` but returns a stable type so the UI doesn't have to parse
   * extensions. Identical implementation to readdir today; kept distinct
   * so the UI's surface can evolve (e.g. include child counts) without
   * changing the just-bash-facing interface.
   */
  async list(path: string): Promise<DirEntry[]> {
    return this.readdir(path);
  }

  /** Resolve a path to its source-artifact UUID, or `null` if no visible
   * file exists at that path. Used by Phase 4 (legacy getter shim) to
   * convert source-specific IDs into paths. */
  async resolveArtifactId(path: string): Promise<string | null> {
    const norm = normalizePath(path);
    const aclLiteral = formatTextArray(this.userSubjects);
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM source_artifacts
      WHERE organization_id = ${this.organizationId}
        AND path = ${norm}
        AND deleted_at IS NULL
        AND acl_subjects && ${aclLiteral}::text[]
      LIMIT 1
    `);
    return unwrapRows<{ id: string }>(result)[0]?.id ?? null;
  }
}

// Re-export path helpers that may be useful at the call site.
export { normalizePath, asDirPrefix, basename, nextSegmentAfter };
