import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';

export const getCallInputSchema = z.object({
  recording_id: z.string().min(1),
});

export interface GetCallToolContext {
  db: DB;
  organizationId: string;
}

export async function runGetCallTool(
  ctx: GetCallToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getCallInputSchema.parse(rawInput);
  const externalId = `grain-call:${input.recording_id}`;

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
      problem: `No call artifact for recording_id ${input.recording_id}`,
      fix: 'Verify the recording has been ingested via the Grain connector.',
    });
  }
  const artifactId = rows[0]!.id;
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
