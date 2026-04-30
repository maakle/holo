import { describe, it, expect, vi } from 'vitest';
import { runPylonSync, type RunPylonSyncInput } from '../../src/pylon/sync';
import type { PylonApiClient } from '../../src/pylon/api-client';

function mockClient(overrides: Partial<PylonApiClient> = {}): PylonApiClient {
  return {
    listIssues: vi.fn().mockResolvedValue({
      issues: [
        {
          id: 'tkt-001',
          title: 'Login broken',
          status: 'open',
          priority: 'high',
          created_at: '2024-09-01T09:00:00Z',
          updated_at: '2024-09-01T10:00:00Z',
          customer: { name: 'Jane', email: 'jane@acme.com' },
          company: { name: 'Acme' },
          assignee: { name: 'Support' },
          tags: ['auth'],
        },
      ],
      nextCursor: undefined,
    }),
    getIssueMessages: vi.fn().mockResolvedValue([
      {
        id: 'm1',
        author: 'Jane',
        author_type: 'customer' as const,
        created_at: '2024-09-01T09:05:00Z',
        body: 'Cannot log in.',
      },
    ]),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunPylonSyncInput> = {}): RunPylonSyncInput {
  return {
    client: mockClient(),
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runPylonSync', () => {
  it('fetches issues and enqueues chunks', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const result = await runPylonSync(baseInput({ enqueueEmbed }));
    expect(result.artifactCount).toBe(1);
    expect(enqueueEmbed).toHaveBeenCalledOnce();
    const call = enqueueEmbed.mock.calls[0]![0];
    expect(call.issueId).toBe('tkt-001');
    expect(call.chunks[0].provider).toBe('pylon');
  });

  it('skips already-seen content hashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const existingHashes = new Set<string>();
    await runPylonSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).toHaveBeenCalledOnce();

    enqueueEmbed.mockClear();
    await runPylonSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('tracks latestUpdatedAt', async () => {
    const result = await runPylonSync(baseInput());
    expect(result.latestUpdatedAt).toBe('2024-09-01T10:00:00Z');
  });

  it('passes updatedAfter to client.listIssues', async () => {
    const client = mockClient();
    await runPylonSync(baseInput({ client, updatedAfter: '2024-08-01T00:00:00Z' }));
    expect(client.listIssues).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAfter: '2024-08-01T00:00:00Z' }),
    );
  });

  it('handles message fetch failure gracefully', async () => {
    const warnings: string[] = [];
    const client = mockClient({
      getIssueMessages: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const result = await runPylonSync(
      baseInput({ client, logger: { warn: (m) => warnings.push(m) } }),
    );
    expect(result.artifactCount).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('paginates: follows nextCursor', async () => {
    let call = 0;
    const client = mockClient({
      listIssues: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            issues: [
              {
                id: `tkt-00${call}`,
                title: 'Issue A',
                status: 'open',
                created_at: '2024-09-01T09:00:00Z',
                updated_at: '2024-09-01T09:30:00Z',
                tags: [],
              },
            ],
            nextCursor: 'page-2',
          });
        }
        return Promise.resolve({
          issues: [
            {
              id: `tkt-00${call}`,
              title: 'Issue B',
              status: 'closed',
              created_at: '2024-09-02T09:00:00Z',
              updated_at: '2024-09-02T09:30:00Z',
              tags: [],
            },
          ],
          nextCursor: undefined,
        });
      }),
    });
    const result = await runPylonSync(baseInput({ client }));
    expect(result.artifactCount).toBe(2);
  });

  it('returns zero artifactCount if no issues', async () => {
    const client = mockClient({
      listIssues: vi.fn().mockResolvedValue({ issues: [], nextCursor: undefined }),
    });
    const result = await runPylonSync(baseInput({ client }));
    expect(result.artifactCount).toBe(0);
  });
});
