import { grainCallChunker } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import type { GrainApiClient } from './api-client';

export type GrainChunkPayload = {
  kind: 'grain-call';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'grain';
  sourceId: string;
  organizationId: string;
};

export type GrainEmbedEnqueueFn = (payload: {
  recordingId: string;
  chunks: GrainChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface RunGrainSyncInput {
  client: GrainApiClient;
  updatedAfter?: string;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: GrainEmbedEnqueueFn;
  logger?: { warn(msg: string): void };
}

export interface RunGrainSyncOutput {
  artifactCount: number;
  latestStartedAt: string | null;
}

export async function runGrainSync(input: RunGrainSyncInput): Promise<RunGrainSyncOutput> {
  const logger = input.logger ?? { warn: () => {} };
  let cursor: string | undefined;
  let totalArtifacts = 0;
  let latestStartedAt: string | null = null;

  do {
    const page = await input.client.listRecordings({
      updatedAfter: input.updatedAfter,
      cursor,
    });

    for (const rec of page.recordings) {
      const artifactId = `grain-call:${rec.id}`;
      let turns: Awaited<ReturnType<GrainApiClient['getTranscript']>> = [];
      try {
        turns = await input.client.getTranscript(rec.id);
      } catch (err) {
        logger.warn(`grain: skipping transcript for ${rec.id}: ${(err as Error).message}`);
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

      const rawChunks = await grainCallChunker.chunk(callInput, {
        organizationId: input.organizationId,
        sourceId: input.sourceId,
        sourceArtifactId: artifactId,
      });

      const newChunks: GrainChunkPayload[] = [];
      for (const c of rawChunks) {
        const hash = chunkHash('grain-call', c.content);
        if (input.existingHashes.has(hash)) continue;
        input.existingHashes.add(hash);
        newChunks.push({
          kind: 'grain-call',
          content: c.content,
          metadata: c.metadata,
          aclSubjects: c.aclSubjects,
          contentHash: hash,
          sourceArtifactId: artifactId,
          provider: 'grain',
          sourceId: input.sourceId,
          organizationId: input.organizationId,
        });
      }

      if (newChunks.length > 0) {
        await input.enqueueEmbed({
          recordingId: rec.id,
          chunks: newChunks,
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        });
      }

      totalArtifacts++;
      if (!latestStartedAt || rec.start_datetime > latestStartedAt) {
        latestStartedAt = rec.start_datetime;
      }
    }

    cursor = page.nextCursor;
  } while (cursor);

  return { artifactCount: totalArtifacts, latestStartedAt };
}
