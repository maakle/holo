import { describe, it, expect } from 'vitest';
import { githubPrChunker, type GithubPrInput } from '../src/github-pr';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function basePr(overrides: Partial<GithubPrInput> = {}): GithubPrInput {
  return {
    prNumber: 42,
    repoFullName: 'acme/api',
    title: 'Add MFA',
    body: 'Adds TOTP-based multi-factor authentication.',
    files: [{ path: 'src/auth.ts', patch: '+ some diff' }],
    reviews: [],
    ...overrides,
  };
}

describe('githubPrChunker', () => {
  it('PR with 2 files + 1 review with 2 line-comments → 3 chunks in order', async () => {
    const pr = basePr({
      files: [
        { path: 'src/auth.ts', patch: '+ a' },
        { path: 'src/api.ts', patch: '+ b' },
      ],
      reviews: [
        {
          author: 'reviewer1',
          body: 'lgtm',
          comments: [
            { author: 'reviewer1', path: 'src/auth.ts', body: 'nit', line: 10 },
            { author: 'reviewer1', path: 'src/api.ts', body: 'fine', line: 20 },
          ],
        },
      ],
    });
    const chunks = await githubPrChunker.chunk(pr, ctx);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.metadata.kind)).toEqual(['title', 'diff', 'review']);
    expect(new Set(chunks.map((c) => c.parentExternalId)).size).toBe(1);
    expect(chunks[0]!.parentExternalId).toBe('pr:acme/api#42');
  });

  it('PR with 0 reviews → 2 chunks (title, diff)', async () => {
    const chunks = await githubPrChunker.chunk(basePr({ reviews: [] }), ctx);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.metadata.kind)).toEqual(['title', 'diff']);
  });

  it('PR with linkedIssue → title chunk includes issue body verbatim', async () => {
    const pr = basePr({
      linkedIssue: { number: 99, title: 'MFA bug', body: 'Users cannot login.' },
    });
    const chunks = await githubPrChunker.chunk(pr, ctx);
    expect(chunks[0]!.content).toContain('Linked issue #99: MFA bug');
    expect(chunks[0]!.content).toContain('Users cannot login.');
  });

  it('all chunks have aclSubjects length 1, prefix org:', async () => {
    const chunks = await githubPrChunker.chunk(basePr(), ctx);
    for (const c of chunks) {
      expect(c.aclSubjects).toHaveLength(1);
      expect(c.aclSubjects[0]).toMatch(/^org:/);
    }
  });

  it('chunker exposes correct kind and embeddingModel', () => {
    expect(githubPrChunker.kind).toBe('github-pr');
    expect(githubPrChunker.embeddingModel).toBe('openai-3-small');
  });
});
