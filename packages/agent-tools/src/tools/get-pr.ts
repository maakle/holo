import { z } from 'zod';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { resolveArtifactIdByExternalId } from './_artifact-lookup';

export const getPrInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().min(1),
});

export interface GetPrToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export async function runGetPrTool(
  ctx: GetPrToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getPrInputSchema.parse(rawInput);
  const externalId = `pr:${input.owner}/${input.repo}#${input.number}`;

  const artifactId = await resolveArtifactIdByExternalId(
    ctx.db,
    ctx.organizationId,
    externalId,
    ctx.userSubjects,
    `No PR artifact for ${externalId}`,
    'Verify the PR has been ingested and you have access to that repository.',
  );

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
