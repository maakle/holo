import { describe, it, expect } from 'vitest';
import { renderArtifact, type ChunkLike } from '../src/render';

const baseDate = new Date('2026-05-14T10:00:00Z');

function chunk(partial: Partial<ChunkLike>): ChunkLike {
  return {
    kind: partial.kind ?? 'generic',
    content: partial.content ?? '',
    metadata: partial.metadata ?? null,
    createdAt: partial.createdAt ?? baseDate,
  };
}

describe('renderArtifact', () => {
  it('default renderer joins chunks with a separator', () => {
    const out = renderArtifact(
      'pylon-ticket',
      [chunk({ content: 'Title' }), chunk({ content: 'Body' })],
      2,
    );
    expect(out.content).toBe('Title\n\n---\n\nBody');
    expect(out.redactedChunkCount).toBe(0);
  });

  it('GitHub PR orders title, diff, review', () => {
    const out = renderArtifact(
      'github-pr',
      [
        chunk({ kind: 'github-pr', content: 'D', metadata: { kind: 'diff' } }),
        chunk({ kind: 'github-pr', content: 'R', metadata: { kind: 'review' } }),
        chunk({ kind: 'github-pr', content: 'T', metadata: { kind: 'title' } }),
      ],
      3,
    );
    expect(out.content).toBe('T\n\nD\n\nR');
  });

  it('Grain call puts summary before transcript and sorts transcript by chunk_index', () => {
    const out = renderArtifact(
      'grain-call',
      [
        chunk({
          content: 'T2',
          metadata: { chunk_kind: 'transcript', chunk_index: 2 },
        }),
        chunk({ content: 'S', metadata: { chunk_kind: 'summary' } }),
        chunk({
          content: 'T1',
          metadata: { chunk_kind: 'transcript', chunk_index: 1 },
        }),
      ],
      3,
    );
    expect(out.content).toBe('S\n\nT1\n\nT2');
  });

  it('surfaces a redaction marker when total > visible', () => {
    const out = renderArtifact(
      'pylon-ticket',
      [chunk({ content: 'Visible' })],
      3, // 2 redacted
    );
    expect(out.content).toContain('Visible');
    expect(out.content).toContain('[redacted 2 chunk(s)');
    expect(out.redactedChunkCount).toBe(2);
  });

  it('strips empty-content chunks before joining', () => {
    const out = renderArtifact(
      'pylon-ticket',
      [chunk({ content: 'A' }), chunk({ content: '' }), chunk({ content: 'B' })],
      3,
    );
    expect(out.content).toBe('A\n\n---\n\nB');
  });
});
