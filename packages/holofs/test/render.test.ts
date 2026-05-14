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

  it('Notion: drops page-summary chunk and translates block types to Markdown', () => {
    const out = renderArtifact(
      'notion-page',
      [
        chunk({
          kind: 'notion-page',
          content: 'crumb / paragraph: foo: bar baz quux',
          metadata: { kind: 'page' },
        }),
        chunk({
          kind: 'notion-page',
          content: 'Eng / Arch / heading_1\nIntro',
          metadata: { kind: 'block', block_type: 'heading_1' },
        }),
        chunk({
          kind: 'notion-page',
          content: 'Eng / Arch / paragraph\nHello world',
          metadata: { kind: 'block', block_type: 'paragraph' },
        }),
        chunk({
          kind: 'notion-page',
          content: 'Eng / Arch / bulleted_list_item\nFirst item',
          metadata: { kind: 'block', block_type: 'bulleted_list_item' },
        }),
        chunk({
          kind: 'notion-page',
          content: 'Eng / Arch / code\nconst x = 1;',
          metadata: { kind: 'block', block_type: 'code' },
        }),
      ],
      5,
    );
    expect(out.content).toBe(
      '# Intro\n\nHello world\n\n- First item\n\n```\nconst x = 1;\n```',
    );
  });

  it('Notion: falls back to parsing block_type from content header when metadata is absent', () => {
    const out = renderArtifact(
      'notion-page',
      [
        chunk({
          kind: 'notion-page',
          content: 'Eng / Arch / heading_2\nLegacy chunk',
          metadata: { kind: 'block' },
        }),
      ],
      1,
    );
    expect(out.content).toBe('## Legacy chunk');
  });

  it('header-dedup renderer (github-doc): emits shared breadcrumb once, joins bodies', () => {
    const out = renderArtifact(
      'github-doc',
      [
        chunk({
          kind: 'github-doc',
          content: 'kombo-io/repo / docs/api.md\n\nFirst chunk body.',
        }),
        chunk({
          kind: 'github-doc',
          content: 'kombo-io/repo / docs/api.md\n\nSecond chunk body.',
        }),
        chunk({
          kind: 'github-doc',
          content: 'kombo-io/repo / docs/api.md\n\nThird chunk body.',
        }),
      ],
      3,
    );
    // Header appears exactly once; bodies joined with `---`.
    expect(out.content.match(/docs\/api\.md/g)?.length).toBe(1);
    expect(out.content).toBe(
      'kombo-io/repo / docs/api.md\n\nFirst chunk body.\n\n---\n\nSecond chunk body.\n\n---\n\nThird chunk body.',
    );
  });

  it('header-dedup renderer (webcrawl-page): strips multi-line title+URL header', () => {
    const out = renderArtifact(
      'webcrawl-page',
      [
        chunk({
          kind: 'webcrawl-page',
          content: 'Kombo Docs\nhttps://docs.kombo.dev/intro\n\nIntro section text.',
        }),
        chunk({
          kind: 'webcrawl-page',
          content: 'Kombo Docs\nhttps://docs.kombo.dev/intro\n\nMore intro text.',
        }),
      ],
      2,
    );
    expect(out.content).toBe(
      'Kombo Docs\nhttps://docs.kombo.dev/intro\n\nIntro section text.\n\n---\n\nMore intro text.',
    );
  });

  it('header-dedup renderer: single chunk renders verbatim (no header detection)', () => {
    const out = renderArtifact(
      'github-doc',
      [
        chunk({
          kind: 'github-doc',
          content: 'kombo-io/repo / docs/api.md\n\nOnly body.',
        }),
      ],
      1,
    );
    expect(out.content).toBe('kombo-io/repo / docs/api.md\n\nOnly body.');
  });

  it('header-dedup renderer: chunks with no shared prefix render bodies without a header', () => {
    const out = renderArtifact(
      'github-doc',
      [
        chunk({ kind: 'github-doc', content: 'Alpha body' }),
        chunk({ kind: 'github-doc', content: 'Beta body' }),
      ],
      2,
    );
    expect(out.content).toBe('Alpha body\n\n---\n\nBeta body');
  });

  it('github-code: wraps source in a fenced code block tagged with language', () => {
    const out = renderArtifact(
      'github-code',
      [
        chunk({
          kind: 'github-code',
          content: 'export function foo() {\n  return 1;\n}',
          metadata: { language: 'typescript', start_line: 1, end_line: 3 },
        }),
      ],
      1,
    );
    expect(out.content).toBe(
      '```typescript\nexport function foo() {\n  return 1;\n}\n```',
    );
  });

  it('github-code: orders chunks by start_line and dedupes recursive-split overlap', () => {
    const out = renderArtifact(
      'github-code',
      [
        chunk({
          kind: 'github-code',
          content: 'line3\nline4\nline5',
          metadata: { language: 'tsx', start_line: 3, end_line: 5 },
        }),
        chunk({
          kind: 'github-code',
          content: 'line1\nline2\nline3\nline4',
          metadata: { language: 'tsx', start_line: 1, end_line: 4 },
        }),
      ],
      2,
    );
    // Sorted by start_line; "line3\nline4" overlap is folded once.
    expect(out.content).toBe('```tsx\nline1\nline2\nline3\nline4\nline5\n```');
  });

  it('github-code: AST chunks (no overlap) concatenate cleanly', () => {
    const out = renderArtifact(
      'github-code',
      [
        chunk({
          kind: 'github-code',
          content: 'function a() {}',
          metadata: { language: 'javascript', start_line: 1, end_line: 1 },
        }),
        chunk({
          kind: 'github-code',
          content: 'function b() {}',
          metadata: { language: 'javascript', start_line: 3, end_line: 3 },
        }),
      ],
      2,
    );
    expect(out.content).toBe(
      '```javascript\nfunction a() {}\n\nfunction b() {}\n```',
    );
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
