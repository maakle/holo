import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';

export const getPrInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().min(1),
});

export interface GetPrToolContext {
  db: DB;
  organizationId: string;
}

export async function runGetPrTool(
  ctx: GetPrToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getPrInputSchema.parse(rawInput);
  const externalId = `pr:${input.owner}/${input.repo}#${input.number}`;

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
      problem: `No PR artifact for ${externalId}`,
      fix: 'Verify the PR has been ingested.',
    });
  }
  const artifactId = rows[0]!.id;

  const { ordered } = await getArtifact({ db: ctx.db, artifactId, organizationId: ctx.organizationId });

  const titleChunk = ordered.find((c) => c.metadata['kind'] === 'title');
  const diffChunk = ordered.find((c) => c.metadata['kind'] === 'diff');
  const reviewChunk = ordered.find((c) => c.metadata['kind'] === 'review');

  return {
    pr_number: input.number,
    repo_full_name: `${input.owner}/${input.repo}`,
    title: titleChunk?.content ?? '',
    diff: diffChunk?.content ?? '',
    reviews: reviewChunk?.content ?? '',
  };
}
