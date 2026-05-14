/**
 * GET /api/files?path=/&limit=200
 *
 * Returns a directory listing scoped to the signed-in user's ACL subjects
 * (NOT just the org's full set). Mirrors what `bash ls /...` would see
 * from the MCP `bash` tool — both surfaces use the same `HoloFs`.
 *
 * RFC 0009 Phase 5.
 */
import { sql } from 'drizzle-orm';
import { HoloFs } from '@holo/holofs';
import { getSubjectsForUser } from '@holo/user-subjects';
import { holoError, ErrorCode } from '@holo/errors';
import { withActiveOrg } from '@/lib/with-active-org';

export const dynamic = 'force-dynamic';

interface DirChild {
  name: string;
  type: 'file' | 'directory';
  /** Source provider for the first artifact under this entry, used by the
   * UI to pick an icon. Null for entries containing no visible files (a
   * directory whose subtree was redacted by ACL). */
  source: string | null;
  /** Most recent `fetched_at` of any visible descendant — used to render
   * "synced X ago" in the list. */
  updatedAt: string | null;
  /** For files: the source-system kind (slack-thread, github-pr, …); for
   * directories, null. */
  kind: string | null;
  /** Total byte size of rendered chunk content under this entry. For files,
   * the sum of `octet_length(content)` across the artifact's visible chunks;
   * for directories, the sum across all visible descendants. Approximate —
   * does not include per-chunk render separators. */
  sizeBytes: number;
}

export const GET = withActiveOrg(async ({ req, ctx, session, orgId }) => {
  const path = req.nextUrl.searchParams.get('path') ?? '/';
  const limit = Math.min(
    1000,
    Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 200)),
  );

  const userId = session.user.id;
  const extraSubjects = await getSubjectsForUser(ctx.db, userId);
  const userSubjects = [`org:${orgId}`, `user:${userId}`, ...extraSubjects];

  const fs = new HoloFs({ db: ctx.db, organizationId: orgId, userSubjects });

  let baseEntries: Awaited<ReturnType<HoloFs['readdir']>>;
  try {
    baseEntries = await fs.readdir(path);
  } catch (err) {
    if ((err as { code?: string }).code === 'EINVAL') {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: (err as Error).message,
        fix: 'Use an absolute POSIX path (starts with /, no .. segments).',
      });
    }
    throw err;
  }

  // Enrich each entry with source provenance + most-recent updatedAt so the
  // UI doesn't have to round-trip per row. Pull the raw rows for visible
  // artifacts under the prefix and group by next segment in JS — same
  // reason as HoloFs.readdir: Postgres `substring(text, integer)` and
  // `substring(text, text)` are different functions (the text variant is
  // POSIX regex matching) and drizzle binds JS numbers as text by default.
  const prefix = path === '/' ? '/' : path.endsWith('/') ? path : path + '/';
  const aclArrayLiteral = `{${userSubjects
    .map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`;

  type EnrichmentRow = {
    path: string;
    kind: string;
    provider: string;
    fetched_at: Date | string;
    size_bytes: number | string | null;
  };

  // Size = sum of octet_length(content) across the artifact's chunks that
  // pass the same ACL check. Done as a LATERAL aggregate so each artifact
  // gets one row; correlated subquery would also work but LATERAL keeps the
  // plan obvious. The chunk-level ACL re-check matches what HoloFs.readFile
  // does for defense in depth.
  const enrichment = await ctx.db.execute<EnrichmentRow>(sql`
    SELECT sa.path,
           sa.kind,
           COALESCE(s.provider, sa.kind) AS provider,
           sa.fetched_at,
           COALESCE(sz.size_bytes, 0) AS size_bytes
    FROM source_artifacts sa
    LEFT JOIN sources s ON s.id = sa.source_id
    LEFT JOIN LATERAL (
      SELECT SUM(octet_length(c.content))::bigint AS size_bytes
      FROM chunks c
      WHERE c.source_artifact_id = sa.id
        AND c.acl_subjects && ${aclArrayLiteral}::text[]
    ) sz ON TRUE
    WHERE sa.organization_id = ${orgId}
      AND sa.path IS NOT NULL
      AND sa.deleted_at IS NULL
      AND sa.path LIKE ${prefix + '%'}
      AND sa.acl_subjects && ${aclArrayLiteral}::text[]
  `);

  const rawRows = (
    (enrichment as unknown as { rows?: EnrichmentRow[] }).rows
      ?? (enrichment as unknown as EnrichmentRow[])
  ) ?? [];

  type Group = {
    name: string;
    is_file: boolean;
    provider: string;
    updated_at: Date | string;
    kind: string;
    size_bytes: number;
  };
  const groupedByName = new Map<string, Group>();
  for (const r of rawRows) {
    if (!r.path.startsWith(prefix)) continue;
    const rest = r.path.slice(prefix.length);
    if (rest.length === 0) continue;
    const slashIdx = rest.indexOf('/');
    const name = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
    const isFile = slashIdx === -1;
    const existing = groupedByName.get(name);
    const fetched = r.fetched_at instanceof Date ? r.fetched_at : new Date(r.fetched_at);
    // size_bytes can come back as string for bigint depending on driver.
    const sizeNum = Number(r.size_bytes ?? 0) || 0;
    if (!existing) {
      groupedByName.set(name, {
        name,
        is_file: isFile,
        provider: r.provider,
        updated_at: fetched,
        kind: r.kind,
        size_bytes: sizeNum,
      });
    } else {
      // A segment is a directory if ANY underlying path makes it so.
      // Provider/kind/updated_at take the max-fetched_at row; size is the
      // sum across every artifact under this segment.
      const existingFetched =
        existing.updated_at instanceof Date
          ? existing.updated_at
          : new Date(existing.updated_at);
      if (fetched > existingFetched) {
        existing.provider = r.provider;
        existing.kind = r.kind;
        existing.updated_at = fetched;
      }
      existing.size_bytes += sizeNum;
      if (!isFile) existing.is_file = false;
    }
    if (groupedByName.size >= limit) break;
  }
  const enrichmentByName = groupedByName;

  const entries: DirChild[] = baseEntries.map((e) => {
    const enrich = enrichmentByName.get(e.name);
    return {
      name: e.name,
      type: e.type,
      source: enrich?.provider ?? null,
      updatedAt: enrich?.updated_at
        ? (enrich.updated_at instanceof Date
            ? enrich.updated_at.toISOString()
            : new Date(enrich.updated_at).toISOString())
        : null,
      kind: e.type === 'file' ? enrich?.kind ?? null : null,
      sizeBytes: enrich?.size_bytes ?? 0,
    };
  });

  return { path, entries };
});
