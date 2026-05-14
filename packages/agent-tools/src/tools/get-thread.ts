import { z } from 'zod';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { resolveArtifactIdByExternalId } from './_artifact-lookup';

export const getThreadInputSchema = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1),
});

export interface GetThreadToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export async function runGetThreadTool(
  ctx: GetThreadToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getThreadInputSchema.parse(rawInput);
  const externalId = `slack-thread:${input.channel}:${input.ts}`;

  const artifactId = await resolveArtifactIdByExternalId(
    ctx.db,
    ctx.organizationId,
    externalId,
    ctx.userSubjects,
    `No thread artifact for ${externalId}`,
    'Verify the channel/ts pair has been ingested and you have access to that channel.',
  );
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
