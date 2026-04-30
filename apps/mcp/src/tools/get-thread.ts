import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';

export const getThreadInputSchema = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1),
});

export interface GetThreadToolContext {
  db: DB;
  organizationId: string;
}

export async function runGetThreadTool(
  ctx: GetThreadToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getThreadInputSchema.parse(rawInput);
  const externalId = `slack-thread:${input.channel}:${input.ts}`;

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
      problem: `No thread artifact for ${externalId}`,
      fix: 'Verify the channel/ts pair has been ingested.',
    });
  }
  const artifactId = rows[0]!.id;
  const { chunks } = await getArtifact({
    db: ctx.db,
    artifactId,
    organizationId: ctx.organizationId,
  });
  const chunk = chunks[0]!;

  return {
    channel_id: input.channel,
    channel_name: chunk.metadata['channel_name'],
    thread_ts: input.ts,
    permalink: chunk.metadata['permalink'],
    content: chunk.content,
    participant_user_ids: chunk.metadata['participant_user_ids'] ?? [],
  };
}
