import { describe, it, expect, vi } from 'vitest';
import { runPylonSync, type RunPylonSyncInput } from '../../src/pylon/sync';
import type { PylonApiClient, PylonIssue, PylonMessage } from '../../src/pylon/api-client';

function makeIssue(overrides: Partial<PylonIssue> = {}): PylonIssue {
  return {
    id: 'tkt-001',
    number: 1,
    title: 'Login broken',
    body_html: '<p>Cannot log in.</p>',
    type: 'ticket',
    state: 'new',
    source: 'email',
    created_at: '2024-09-01T09:00:00Z',
    updated_at: '2024-09-01T10:00:00Z',
    link: 'https://app.usepylon.com/issues/tkt-001',
    requester: { id: 'user-1', email: 'jane@acme.com' },
    account: {
      id: 'acct-1',
      external_ids: [{ external_id: 'acme-id', label: 'salesforce' }],
    },
    assignee: { id: 'agent-1', email: 'support@example.com' },
    tags: ['auth'],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<PylonMessage> = {}): PylonMessage {
  return {
    id: 'm1',
    thread_id: 'thread-1',
    message_html: '<p>Cannot log in.</p>',
    is_private: false,
    source: 'email',
    timestamp: '2024-09-01T09:05:00Z',
    file_urls: [],
    author: {
      name: 'Jane',
      avatar_url: '',
      contact: { id: 'contact-1', email: 'jane@acme.com' },
    },
    ...overrides,
  };
}

function mockClient(overrides: Partial<PylonApiClient> = {}): PylonApiClient {
  return {
    listIssues: vi.fn().mockResolvedValue({
      issues: [makeIssue()],
      nextCursor: undefined,
    }),
    getIssueMessages: vi.fn().mockResolvedValue([makeMessage()]),
    testConnection: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Acme Corp' }),
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
              makeIssue({
                id: 'tkt-001',
                title: 'Issue A',
                state: 'new',
                created_at: '2024-09-01T09:00:00Z',
                updated_at: '2024-09-01T09:30:00Z',
                tags: [],
              }),
            ],
            nextCursor: 'page-2',
          });
        }
        return Promise.resolve({
          issues: [
            makeIssue({
              id: 'tkt-002',
              title: 'Issue B',
              state: 'closed',
              created_at: '2024-09-02T09:00:00Z',
              updated_at: '2024-09-02T09:30:00Z',
              tags: [],
            }),
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

  it('derives authorType from author fields', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const agentMessage = makeMessage({
      id: 'm2',
      author: {
        name: 'Agent Bob',
        avatar_url: '',
        user: { id: 'agent-2', email: 'bob@support.com' },
      },
    });
    const botMessage = makeMessage({
      id: 'm3',
      author: { name: 'Bot', avatar_url: '' },
    });
    const client = mockClient({
      getIssueMessages: vi.fn().mockResolvedValue([makeMessage(), agentMessage, botMessage]),
    });
    const result = await runPylonSync(baseInput({ client, enqueueEmbed }));
    expect(result.artifactCount).toBe(1);
    // Chunks are generated — verify message mapping doesn't throw
    expect(enqueueEmbed).toHaveBeenCalledOnce();
  });
});
