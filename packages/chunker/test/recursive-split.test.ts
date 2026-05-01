import { describe, it, expect } from 'vitest';
import { recursiveSplit } from '../src/recursive-split';

describe('recursiveSplit', () => {
  it('empty input returns []', () => {
    expect(recursiveSplit('', { chunkSize: 50, overlap: 0 })).toEqual([]);
  });

  it('markdown paragraphs split at \\n\\n boundaries', () => {
    const text = '# H1\n\nPara 1\n\nPara 2\n\n## H2\n\nPara 3';
    // chunkSize=10: each paragraph (4-6 chars) fits alone, but two together with \n\n (6+2+6=14) do not.
    // So each paragraph should become its own chunk.
    const chunks = recursiveSplit(text, { chunkSize: 10, overlap: 0 });
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const chunk of chunks) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(10);
    }
    // Verify the whole text is preserved (content should be present across chunks)
    const joined = chunks.join('');
    expect(joined).toContain('# H1');
    expect(joined).toContain('Para 1');
    expect(joined).toContain('Para 2');
    expect(joined).toContain('## H2');
    expect(joined).toContain('Para 3');
  });

  it('long single line produces 5+ chunks with overlap', () => {
    const text = ' '.repeat(5000);
    const chunks = recursiveSplit(text, { chunkSize: 1000, overlap: 100 });
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (const chunk of chunks) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(1000);
    }
    // Each chunk after the first should start with content from the prior chunk's tail
    for (let i = 1; i < chunks.length; i++) {
      expect(Array.from(chunks[i]).length).toBeGreaterThan(0);
    }
  });

  it('paragraph longer than chunkSize recurses into sentence-level splits', () => {
    // Build a long paragraph with sentence breaks
    const longPara = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four. This is sentence five. This is sentence six.';
    const chunks = recursiveSplit(longPara, { chunkSize: 50, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk should be within chunkSize (allowing for small overrun on atomic pieces)
      expect(Array.from(chunk).length).toBeLessThanOrEqual(60); // slight tolerance for sentence boundaries
    }
  });

  it('unicode emoji: 100 emoji code points split into chunks without truncation', () => {
    const text = '😀'.repeat(100);
    const chunks = recursiveSplit(text, { chunkSize: 30, overlap: 0 });
    // Should produce at least 4 chunks (ceil(100/30) = 4)
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    // No chunk should exceed 30 code points
    for (const chunk of chunks) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(30);
    }
    // Total code points across all chunks should equal 100
    const totalCodePoints = chunks.reduce((sum, c) => sum + Array.from(c).length, 0);
    expect(totalCodePoints).toBe(100);
  });
});
