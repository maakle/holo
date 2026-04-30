import { describe, it, expect } from 'vitest';
import { githubDocChunker } from '../src/github-doc.js';
import type { ChunkContext } from '../src/contract.js';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

describe('githubDocChunker', () => {
  it('5,000-char markdown → ≥4 chunks, each starts with breadcrumb', async () => {
    const content = 'paragraph.\n\n'.repeat(420); // ~5040 chars
    const chunks = await githubDocChunker.chunk(
      { repoFullName: 'acme/api', filePath: 'docs/x.md', content },
      ctx,
    );
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) {
      expect(c.content.startsWith('acme/api / docs/x.md\n\n')).toBe(true);
    }
  });

  it('single short paragraph (<1200 chars) → 1 chunk', async () => {
    const chunks = await githubDocChunker.chunk(
      { repoFullName: 'acme/api', filePath: 'README.md', content: 'short doc' },
      ctx,
    );
    expect(chunks).toHaveLength(1);
  });

  it('empty content → 0 chunks', async () => {
    const chunks = await githubDocChunker.chunk(
      { repoFullName: 'acme/api', filePath: 'README.md', content: '' },
      ctx,
    );
    expect(chunks).toEqual([]);
  });

  it('parentExternalId matches doc:repo:path', async () => {
    const chunks = await githubDocChunker.chunk(
      { repoFullName: 'acme/api', filePath: 'docs/x.md', content: 'some doc' },
      ctx,
    );
    expect(chunks[0]!.parentExternalId).toBe('doc:acme/api:docs/x.md');
  });
});
