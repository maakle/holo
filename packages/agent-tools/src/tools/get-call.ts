import { z } from 'zod';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { resolveArtifactIdByExternalId } from './_artifact-lookup';

export const getCallInputSchema = z.object({
  recording_id: z.string().min(1),
});

export interface GetCallToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export async function runGetCallTool(
  ctx: GetCallToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getCallInputSchema.parse(rawInput);
  const externalId = `grain-call:${input.recording_id}`;

  const artifactId = await resolveArtifactIdByExternalId(
    ctx.db,
    ctx.organizationId,
    externalId,
    ctx.userSubjects,
    `No call artifact for recording_id ${input.recording_id}`,
    'Verify the recording has been ingested via the Grain connector and you have access.',
  );
  const { chunks } = await getArtifact({
    db: ctx.db,
    artifactId,
    organizationId: ctx.organizationId,
  });

  const summary = chunks.find((c) => c.metadata['chunk_kind'] === 'summary');
  const transcriptChunks = chunks
    .filter((c) => c.metadata['chunk_kind'] === 'transcript')
    .sort((a, b) => ((a.metadata['chunk_index'] as number) ?? 0) - ((b.metadata['chunk_index'] as number) ?? 0));

  return {
    recording_id: input.recording_id,
    title: summary?.metadata['title'],
    started_at: summary?.metadata['started_at'],
    duration_ms: summary?.metadata['duration_ms'],
    participants: summary?.metadata['participants'] ?? [],
    summary: summary?.content,
    transcript: transcriptChunks.map((c) => c.content).join('\n\n'),
  };
}
