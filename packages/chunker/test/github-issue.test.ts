import { describe, it, expect } from 'vitest';
import { githubIssueChunker, type GithubIssueInput } from '../src/github-issue.js';
import type { ChunkContext } from '../src/contract.js';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function baseIssue(overrides: Partial<GithubIssueInput> = {}): GithubIssueInput {
  return {
    issueNumber: 7,
    repoFullName: 'acme/api',
    title: 'Bug',
    body: 'Something broken',
    comments: [],
    ...overrides,
  };
}

describe('githubIssueChunker', () => {
  it('0 comments → 1 chunk (body only)', async () => {
    const chunks = await githubIssueChunker.chunk(baseIssue(), ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata.kind).toBe('body');
  });

  it('1 comment → 2 chunks [body, comment]', async () => {
    const chunks = await githubIssueChunker.chunk(
      baseIssue({ comments: [{ author: 'alice', body: 'me too' }] }),
      ctx,
    );
    expect(chunks.map((c) => c.metadata.kind)).toEqual(['body', 'comment']);
  });

  it('3 comments → 4 chunks [body, comment, comment, comment]', async () => {
    const chunks = await githubIssueChunker.chunk(
      baseIssue({
        comments: [
          { author: 'a', body: '1' },
          { author: 'b', body: '2' },
          { author: 'c', body: '3' },
        ],
      }),
      ctx,
    );
    expect(chunks).toHaveLength(4);
    expect(chunks.map((c) => c.metadata.kind)).toEqual(['body', 'comment', 'comment', 'comment']);
    expect(new Set(chunks.map((c) => c.parentExternalId)).size).toBe(1);
    expect(chunks[0]!.parentExternalId).toBe('issue:acme/api#7');
  });

  it('empty body still produces a body chunk', async () => {
    const chunks = await githubIssueChunker.chunk(baseIssue({ body: '' }), ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('# Bug\n\n');
  });
});
