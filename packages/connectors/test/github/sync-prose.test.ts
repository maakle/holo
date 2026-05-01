import { describe, it, expect, vi } from 'vitest';
import {
  runGithubProseSync,
  type RunGithubProseSyncInput,
  type GithubProseEmbedEnqueueFn,
} from '../../src/github/sync-prose';
import type { GithubApiClient, GithubPullRequest, GithubIssue } from '../../src/github/api-client';

function mockRepo() {
  return { full_name: 'org/repo', default_branch: 'main', pushed_at: '2026-04-01T00:00:00Z' };
}

function mockPr(overrides: Partial<GithubPullRequest> = {}): GithubPullRequest {
  return {
    number: 1,
    title: 'Fix the bug',
    body: 'Closes #5\n\nDetails here.',
    state: 'closed',
    updated_at: '2026-04-01T00:00:00Z',
    merged_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function mockIssue(overrides: Partial<GithubIssue> = {}): GithubIssue {
  return {
    number: 5,
    title: 'Bug in the code',
    body: 'Steps to reproduce...',
    state: 'closed',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function mockClient(overrides: Partial<GithubApiClient> = {}): GithubApiClient {
  return {
    getRepo: vi.fn().mockResolvedValue(mockRepo()),
    listPullRequests: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getPrFiles: vi.fn().mockResolvedValue([]),
    getPrReviews: vi.fn().mockResolvedValue([]),
    getPrReviewComments: vi.fn().mockResolvedValue([]),
    listIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getIssueComments: vi.fn().mockResolvedValue([]),
    getIssue: vi.fn().mockResolvedValue(null),
    getTree: vi.fn().mockResolvedValue([]),
    getFileContent: vi.fn().mockResolvedValue(null),
    getRef: vi.fn().mockResolvedValue({ sha: 'abc123' }),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunGithubProseSyncInput> = {}): RunGithubProseSyncInput {
  return {
    client: mockClient(),
    allowedRepos: ['org/repo'],
    cursorMetadata: {},
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runGithubProseSync', () => {
  it('throws HOLO_ALLOWLIST_EMPTY with no repos', async () => {
    await expect(runGithubProseSync(baseInput({ allowedRepos: [] }))).rejects.toMatchObject({
      code: 'HOLO_ALLOWLIST_EMPTY',
    });
  });

  it('syncs a PR and enqueues embed chunks', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const client = mockClient({
      listPullRequests: vi.fn().mockResolvedValue({ items: [mockPr()], hasMore: false }),
      getPrFiles: vi.fn().mockResolvedValue([{ filename: 'src/foo.ts', patch: '+ hello', status: 'modified' }]),
      getPrReviews: vi.fn().mockResolvedValue([]),
      getPrReviewComments: vi.fn().mockResolvedValue([]),
      getIssue: vi.fn().mockResolvedValue(mockIssue()),
    });

    const result = await runGithubProseSync(baseInput({ client, enqueueEmbed }));

    expect(result.artifactCount).toBeGreaterThan(0);
    expect(enqueueEmbed).toHaveBeenCalled();
    const chunks = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0].chunks;
    expect(chunks[0].kind).toBe('github-pr');
    expect(chunks[0].provider).toBe('github');
  });

  it('syncs issues (skipping PR issues)', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const client = mockClient({
      listIssues: vi.fn().mockResolvedValue({
        items: [
          mockIssue({ number: 10, title: 'Real issue' }),
          { ...mockIssue({ number: 11 }), pull_request: { url: 'https://...' } }, // PR disguised as issue
        ],
        hasMore: false,
      }),
      getIssueComments: vi.fn().mockResolvedValue([{ user: { login: 'alice' }, body: 'LGTM' }]),
    });

    const result = await runGithubProseSync(baseInput({ client, enqueueEmbed }));

    expect(result.artifactCount).toBeGreaterThan(0);
    const kinds = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((c: [{ chunks: Array<{ kind: string }> }]) => c[0].chunks.map((ch) => ch.kind));
    expect(kinds).toContain('github-issue');
    expect(kinds).not.toContain('github-pr');
  });

  it('syncs doc files (README.md)', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const client = mockClient({
      getTree: vi.fn().mockResolvedValue([
        { path: 'README.md', type: 'blob', sha: 'sha-readme' },
      ]),
      getFileContent: vi.fn().mockResolvedValue('# Hello\n\nThis is the README.'),
    });

    const result = await runGithubProseSync(baseInput({ client, enqueueEmbed }));

    expect(result.artifactCount).toBeGreaterThan(0);
    const kinds = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((c: [{ chunks: Array<{ kind: string }> }]) => c[0].chunks.map((ch) => ch.kind));
    expect(kinds).toContain('github-doc');
  });

  it('incremental: skips PRs already seen (updated_at ≤ cursor)', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const ts = '2026-04-01T00:00:00Z';
    const client = mockClient({
      listPullRequests: vi.fn().mockResolvedValue({
        items: [mockPr({ updated_at: ts })],
        hasMore: false,
      }),
    });

    const result = await runGithubProseSync(
      baseInput({
        client,
        enqueueEmbed,
        cursorMetadata: { pr_updated_since: { 'org/repo': ts } },
      }),
    );

    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('incremental: skips doc files with unchanged SHA', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const client = mockClient({
      getTree: vi.fn().mockResolvedValue([
        { path: 'README.md', type: 'blob', sha: 'same-sha' },
      ]),
    });

    const result = await runGithubProseSync(
      baseInput({
        client,
        enqueueEmbed,
        cursorMetadata: { doc_shas: { 'org/repo:README.md': 'same-sha' } },
      }),
    );

    expect(result.artifactCount).toBe(0);
    expect(client.getFileContent).not.toHaveBeenCalled();
  });

  it('deduplicates chunks already in existingHashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubProseEmbedEnqueueFn;
    const client = mockClient({
      getTree: vi.fn().mockResolvedValue([
        { path: 'README.md', type: 'blob', sha: 'sha-x' },
      ]),
      getFileContent: vi.fn().mockResolvedValue('# Hello'),
    });

    const r1 = await runGithubProseSync(baseInput({ client, enqueueEmbed }));
    expect(r1.artifactCount).toBeGreaterThan(0);

    const hashes = new Set(
      (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls
        .flatMap((c: [{ chunks: Array<{ contentHash: string }> }]) => c[0].chunks.map((ch) => ch.contentHash)),
    );

    const r2 = await runGithubProseSync(
      baseInput({ client, enqueueEmbed: vi.fn(), existingHashes: hashes }),
    );
    expect(r2.artifactCount).toBe(0);
  });

  it('throws HOLO_GITHUB_TOKEN_INVALID on 401', async () => {
    const client = mockClient({
      getRepo: vi.fn().mockRejectedValue(Object.assign(new Error('401'), { status: 401 })),
    });
    await expect(runGithubProseSync(baseInput({ client }))).rejects.toMatchObject({
      code: 'HOLO_GITHUB_TOKEN_INVALID',
    });
  });

  it('records pr_updated_since and doc_shas in updatedMetadata', async () => {
    const ts = '2026-04-02T00:00:00Z';
    const client = mockClient({
      listPullRequests: vi.fn().mockResolvedValue({
        items: [mockPr({ updated_at: ts })],
        hasMore: false,
      }),
      getTree: vi.fn().mockResolvedValue([
        { path: 'README.md', type: 'blob', sha: 'new-sha' },
      ]),
      getFileContent: vi.fn().mockResolvedValue('# Hi'),
    });

    const result = await runGithubProseSync(baseInput({ client }));
    const meta = result.updatedMetadata;
    expect((meta['pr_updated_since'] as Record<string, string>)['org/repo']).toBe(ts);
    expect((meta['doc_shas'] as Record<string, string>)['org/repo:README.md']).toBe('new-sha');
  });
});
