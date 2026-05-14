import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';
import { resolveArtifactIdByExternalId } from './_artifact-lookup';

export const getDocInputSchema = z.union([
  z.object({ artifact_id: z.string().min(1) }),
  z.object({ notion_page_id: z.string().min(1) }),
  z.object({ github_path: z.string().min(1), repo: z.string().min(1) }),
]);

export interface GetDocToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

function formatTextArray(values: string[]): string {
  const escaped = values.map(
    (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(',')}}`;
}

async function resolveArtifactId(
  ctx: GetDocToolContext,
  input: z.infer<typeof getDocInputSchema>,
): Promise<string> {
  if ('artifact_id' in input) {
    // RFC 0009 Phase 4: even direct-by-id lookups must pass the ACL gate.
    // Otherwise an agent could pass any artifact UUID it saw in another
    // org or under tighter ACL and pull the content back.
    const aclLiteral = formatTextArray(ctx.userSubjects);
    const result = await ctx.db.execute<{ id: string }>(sql`
      SELECT id FROM source_artifacts
      WHERE id = ${input.artifact_id}
        AND organization_id = ${ctx.organizationId}
        AND deleted_at IS NULL
        AND acl_subjects && ${aclLiteral}::text[]
      LIMIT 1
    `);
    const rows = ((result as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (result as unknown as Array<{ id: string }>)) ?? [];
    if (rows.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
        problem: `No accessible doc artifact for id ${input.artifact_id}`,
        fix: 'Verify the artifact id is correct and the caller has access.',
      });
    }
    return rows[0]!.id;
  }

  let externalId: string;
  if ('notion_page_id' in input) {
    externalId = `notion-page:${input.notion_page_id}`;
  } else {
    externalId = `doc:${input.repo}:${input.github_path}`;
  }
  return resolveArtifactIdByExternalId(
    ctx.db,
    ctx.organizationId,
    externalId,
    ctx.userSubjects,
    `No doc artifact for ${externalId}`,
    'Verify the document has been ingested and you have access.',
  );
}

export async function runGetDocTool(
  ctx: GetDocToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getDocInputSchema.parse(rawInput);
  const artifactId = await resolveArtifactId(ctx, input);

  const { ordered, artifactKind } = await getArtifact({
    db: ctx.db,
    artifactId,
    organizationId: ctx.organizationId,
  });

  return {
    kind: artifactKind,
    content: ordered.map((c) => c.content).join('\n\n'),
    breadcrumb: ordered[0]?.metadata['breadcrumb'],
    metadata: ordered[0]?.metadata ?? {},
  };
}
