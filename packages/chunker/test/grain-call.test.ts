import { describe, it, expect } from 'vitest';
import { grainCallChunker, type GrainCallInput } from '../src/grain-call';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function baseCall(overrides: Partial<GrainCallInput> = {}): GrainCallInput {
  return {
    recordingId: 'rec-abc',
    title: 'Q3 Planning',
    startedAt: new Date('2024-09-01T10:00:00Z'),
    durationMs: 3600000,
    participants: ['Alice', 'Bob'],
    summary: 'Discussed Q3 OKRs.',
    turns: [
      { speaker: 'Alice', startMs: 0, endMs: 10000, text: 'Hello everyone.' },
      { speaker: 'Bob', startMs: 10000, endMs: 20000, text: 'Hi Alice.' },
      { speaker: 'Alice', startMs: 20000, endMs: 30000, text: 'Let us start.' },
    ],
    ...overrides,
  };
}

describe('grainCallChunker', () => {
  it('produces at least 2 chunks: summary + transcript', async () => {
    const chunks = await grainCallChunker.chunk(baseCall(), ctx);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const summary = chunks.find((c) => c.metadata['chunk_kind'] === 'summary');
    const transcript = chunks.find((c) => c.metadata['chunk_kind'] === 'transcript');
    expect(summary).toBeDefined();
    expect(transcript).toBeDefined();
  });

  it('summary chunk contains title, date, participants, and summary text', async () => {
    const chunks = await grainCallChunker.chunk(baseCall(), ctx);
    const summary = chunks.find((c) => c.metadata['chunk_kind'] === 'summary')!;
    expect(summary.content).toContain('Q3 Planning');
    expect(summary.content).toContain('2024-09-01');
    expect(summary.content).toContain('Alice');
    expect(summary.content).toContain('Bob');
    expect(summary.content).toContain('Discussed Q3 OKRs.');
  });

  it('transcript chunk contains speaker turns with timestamps', async () => {
    const chunks = await grainCallChunker.chunk(baseCall(), ctx);
    const transcript = chunks.find((c) => c.metadata['chunk_kind'] === 'transcript')!;
    expect(transcript.content).toContain('Alice');
    expect(transcript.content).toContain('Hello everyone.');
    expect(transcript.content).toContain('[00:00]');
  });

  it('consecutive turns by same speaker are merged', async () => {
    const call = baseCall({
      turns: [
        { speaker: 'Alice', startMs: 0, endMs: 5000, text: 'Part one.' },
        { speaker: 'Alice', startMs: 5000, endMs: 10000, text: 'Part two.' },
        { speaker: 'Bob', startMs: 10000, endMs: 20000, text: 'Okay.' },
      ],
    });
    const chunks = await grainCallChunker.chunk(call, ctx);
    const transcript = chunks.find((c) => c.metadata['chunk_kind'] === 'transcript')!;
    const aliceOccurrences = (transcript.content.match(/Alice/g) ?? []).length;
    expect(aliceOccurrences).toBe(1);
  });

  it('aclSubjects contains org subject', async () => {
    const chunks = await grainCallChunker.chunk(baseCall(), ctx);
    for (const chunk of chunks) {
      expect(chunk.aclSubjects).toContain('org:org-1');
    }
  });

  it('parentExternalId is grain-call:<recordingId>', async () => {
    const chunks = await grainCallChunker.chunk(baseCall(), ctx);
    for (const chunk of chunks) {
      expect(chunk.parentExternalId).toBe('grain-call:rec-abc');
    }
  });

  it('no summary field → summary chunk still has title + participants', async () => {
    const call = baseCall({ summary: undefined });
    const chunks = await grainCallChunker.chunk(call, ctx);
    const summary = chunks.find((c) => c.metadata['chunk_kind'] === 'summary')!;
    expect(summary.content).toContain('Q3 Planning');
    expect(summary.content).not.toContain('undefined');
  });

  it('no turns → only summary chunk', async () => {
    const call = baseCall({ turns: [] });
    const chunks = await grainCallChunker.chunk(call, ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata['chunk_kind']).toBe('summary');
  });

  it('long call splits transcript into multiple chunks', async () => {
    const manyTurns = Array.from({ length: 100 }, (_, i) => ({
      speaker: i % 2 === 0 ? 'Alice' : 'Bob',
      startMs: i * 30000,
      endMs: (i + 1) * 30000,
      text: 'x'.repeat(200),
    }));
    const call = baseCall({ turns: manyTurns });
    const chunks = await grainCallChunker.chunk(call, ctx);
    const transcriptChunks = chunks.filter((c) => c.metadata['chunk_kind'] === 'transcript');
    expect(transcriptChunks.length).toBeGreaterThan(1);
  });
});
