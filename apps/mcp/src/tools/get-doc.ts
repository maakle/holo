import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';

export const getDocInputSchema = z.union([
  z.object({ artifact_id: z.string().min(1) }),
  z.object({ notion_page_id: z.string().min(1) }),
  z.object({ github_path: z.string().min(1), repo: z.string().min(1) }),
]);

export interface GetDocToolContext {
  db: DB;
  organizationId: string;
}

async function resolveArtifactId(
  ctx: GetDocToolContext,
  input: z.infer<typeof getDocInputSchema>,
): Promise<string> {
  if ('artifact_id' in input) return input.artifact_id;

  let externalId: string;
  if ('notion_page_id' in input) {
    externalId = `notion-page:${input.notion_page_id}`;
  } else {
    externalId = `doc:${input.repo}:${input.github_path}`;
  }

  const result = await ctx.db.execute<{ id: string } & Record<string, unknown>>(sql`
    SELECT id FROM source_artifacts
    WHERE organization_id = ${ctx.organizationId} AND external_id = ${externalId}
    LIMIT 1
  `);
  const rows = ((result as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (result as unknown as Array<{ id: string }>)) ?? [];
  if (rows.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
      problem: `No doc artifact for ${externalId}`,
      fix: 'Verify the document has been ingested.',
    });
  }
  return rows[0]!.id;
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
