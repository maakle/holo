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
  // UI doesn't have to round-trip per row. One query: for each child segment
  // under `path`, return the provider + max(fetched_at) + a sample kind.
  const prefix = path === '/' ? '/' : path.endsWith('/') ? path : path + '/';
  const aclArrayLiteral = `{${userSubjects
    .map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`;

  const enrichment = await ctx.db.execute<{
    name: string;
    is_file: boolean;
    provider: string;
    updated_at: Date | string;
    kind: string;
  }>(sql`
    WITH visible AS (
      SELECT sa.path, sa.kind, sa.fetched_at,
             COALESCE(s.provider, sa.kind) AS provider
      FROM source_artifacts sa
      LEFT JOIN sources s ON s.id = sa.source_id
      WHERE sa.organization_id = ${orgId}
        AND sa.path IS NOT NULL
        AND sa.deleted_at IS NULL
        AND sa.path LIKE ${prefix + '%'}
        AND sa.acl_subjects && ${aclArrayLiteral}::text[]
    ),
    seg AS (
      SELECT
        CASE
          WHEN position('/' IN substring(path, ${prefix.length + 1})) = 0
            THEN substring(path, ${prefix.length + 1})
          ELSE substring(
            path,
            ${prefix.length + 1},
            position('/' IN substring(path, ${prefix.length + 1})) - 1
          )
        END AS name,
        position('/' IN substring(path, ${prefix.length + 1})) = 0 AS is_file,
        provider,
        fetched_at,
        kind
      FROM visible
    )
    SELECT
      name,
      bool_and(is_file) AS is_file,
      MIN(provider) AS provider,
      MAX(fetched_at) AS updated_at,
      MIN(kind) AS kind
    FROM seg
    WHERE name <> ''
    GROUP BY name
    ORDER BY name
    LIMIT ${limit}
  `);

  const rows = (
    (enrichment as unknown as {
      rows?: Array<{ name: string; is_file: boolean; provider: string; updated_at: Date | string; kind: string }>;
    }).rows ?? (enrichment as unknown as Array<{ name: string; is_file: boolean; provider: string; updated_at: Date | string; kind: string }>)
  ) ?? [];

  const enrichmentByName = new Map(rows.map((r) => [r.name, r]));

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
    };
  });

  return { path, entries };
});
