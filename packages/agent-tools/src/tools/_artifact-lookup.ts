/**
 * Shared helper for the legacy source-specific getters (get_pr, get_thread,
 * get_doc, get_call, get_ticket).
 *
 * RFC 0009 Phase 4: these tools used to look up the source_artifact row by
 * `(organization_id, external_id)` with no per-user ACL check — they
 * trusted the org boundary as sufficient. With the denormalized
 * `source_artifacts.acl_subjects` column landed in migration 0047, the
 * lookup now includes `acl_subjects && $userSubjects::text[]` so a user
 * who can't see a private Slack channel can't backdoor through
 * `get_thread`.
 *
 * The structured return shapes of each getter stay unchanged so MCP
 * clients aren't broken. Long-term these tools are deprecated in favor of
 * `bash` and will be removed once telemetry shows zero traffic.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

function formatTextArray(values: string[]): string {
  const escaped = values.map(
    (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(',')}}`;
}

export async function resolveArtifactIdByExternalId(
  db: DB,
  organizationId: string,
  externalId: string,
  userSubjects: string[],
  notFoundProblem: string,
  notFoundFix: string,
): Promise<string> {
  const aclLiteral = formatTextArray(userSubjects);
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM source_artifacts
    WHERE organization_id = ${organizationId}
      AND external_id = ${externalId}
      AND deleted_at IS NULL
      AND acl_subjects && ${aclLiteral}::text[]
    LIMIT 1
  `);
  const rows = ((result as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (result as unknown as Array<{ id: string }>)) ?? [];
  if (rows.length === 0) {
    // We intentionally do NOT distinguish "doesn't exist" from "exists but
    // you can't see it" — that would leak presence to an unauthorized
    // caller. Same shape as HoloFs ENOENT.
    throw holoError({
      code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
      problem: notFoundProblem,
      fix: notFoundFix,
    });
  }
  return rows[0]!.id;
}
