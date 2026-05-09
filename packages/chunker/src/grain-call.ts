import type { Chunker, Chunk, ChunkContext } from './contract';

export interface GrainSpeakerTurn {
  speaker: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface GrainCallInput {
  recordingId: string;
  title: string;
  startedAt: Date;
  durationMs: number;
  participants: string[];
  summary?: string;
  turns: GrainSpeakerTurn[];
}

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Merge consecutive turns by the same speaker into a single turn to reduce
// chunk fragmentation (Grain sometimes emits multiple small segments per speaker).
function mergeSpeakerRuns(turns: GrainSpeakerTurn[]): GrainSpeakerTurn[] {
  const merged: GrainSpeakerTurn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === t.speaker) {
      last.text += ' ' + t.text;
      last.endMs = t.endMs;
    } else {
      merged.push({ ...t });
    }
  }
  return merged;
}

// Max characters per transcript chunk before we split (≈ 1500 tokens).
const TRANSCRIPT_CHUNK_CHARS = 6000;

export const grainCallChunker: Chunker<GrainCallInput> = {
  kind: 'grain-call',
  embeddingModel: 'openai-3-small',

  async chunk(input: GrainCallInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `grain-call:${input.recordingId}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMetadata = {
      recording_id: input.recordingId,
      title: input.title,
      started_at: input.startedAt.toISOString(),
      duration_ms: input.durationMs,
      participants: input.participants,
    };

    const chunks: Chunk[] = [];

    // 1. Meeting-level summary chunk.
    const summaryLines: string[] = [`# ${input.title}`, ''];
    summaryLines.push(`Date: ${input.startedAt.toISOString().slice(0, 10)}`);
    summaryLines.push(`Duration: ${formatTimestamp(input.durationMs)}`);
    if (input.participants.length > 0) {
      summaryLines.push(`Participants: ${input.participants.join(', ')}`);
    }
    if (input.summary) {
      summaryLines.push('', input.summary);
    }
    chunks.push({
      content: summaryLines.join('\n'),
      parentExternalId,
      metadata: { ...baseMetadata, chunk_kind: 'summary' },
      aclSubjects,
    });

    // 2. Transcript chunks — one or more depending on call length.
    const merged = mergeSpeakerRuns(input.turns);
    if (merged.length === 0) return chunks;

    let buffer = `# ${input.title} — Transcript\n\n`;
    let chunkIndex = 0;

    const flushBuffer = (buf: string): void => {
      chunks.push({
        content: buf.trimEnd(),
        parentExternalId,
        metadata: { ...baseMetadata, chunk_kind: 'transcript', chunk_index: chunkIndex },
        aclSubjects,
      });
      chunkIndex++;
    };

    for (const turn of merged) {
      const line = `[${formatTimestamp(turn.startMs)}] ${turn.speaker}: ${turn.text}\n`;
      if (buffer.length + line.length > TRANSCRIPT_CHUNK_CHARS && buffer.trim().length > 0) {
        flushBuffer(buffer);
        buffer = `# ${input.title} — Transcript (continued)\n\n`;
      }
      buffer += line;
    }
    if (buffer.trim().length > 0) {
      flushBuffer(buffer);
    }

    return chunks;
  },
};
