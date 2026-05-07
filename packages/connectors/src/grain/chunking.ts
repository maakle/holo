/**
 * Grain recording → chunk projection. Each recording produces one or more
 * chunks via @holo/chunker's grainCallChunker; this module fetches the
 * transcript, projects to the chunker's input, and pushes results through
 * ctx.upsert.
 */
import { grainCallChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import { getTranscript } from './api';
import type { GrainRecording, GrainTranscriptTurn } from './types';

/**
 * Index one Grain recording: fetch its transcript, project to the chunker's
 * input, and emit each resulting chunk via ctx.upsert. Recordings continue
 * to be indexed (with title/summary alone) when the transcript call fails.
 */
export async function processRecording(
  ctx: ResourceSyncContext<unknown>,
  rec: GrainRecording,
): Promise<void> {
  let turns: GrainTranscriptTurn[] = [];
  try {
    turns = await getTranscript(ctx.api, rec.id);
  } catch {
    /* skip transcript — call still indexed via title/summary */
  }

  const callInput = {
    recordingId: rec.id,
    title: rec.title,
    startedAt: new Date(rec.start_datetime),
    durationMs: rec.duration_ms,
    participants: rec.participants?.map((p) => p.name) ?? [],
    summary: rec.ai_summary?.text,
    turns: turns.map((t) => ({
      speaker: t.speaker,
      startMs: t.start,
      endMs: t.end,
      text: t.text,
    })),
  };

  const sourceArtifactId = `grain-call:${rec.id}`;
  const rawChunks = await grainCallChunker.chunk(callInput, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: rec.id,
      kind: 'grain-call',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
    });
  }
}
