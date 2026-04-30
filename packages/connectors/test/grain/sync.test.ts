import { describe, it, expect, vi } from 'vitest';
import { runGrainSync, type RunGrainSyncInput } from '../../src/grain/sync';
import type { GrainApiClient } from '../../src/grain/api-client';

function mockClient(overrides: Partial<GrainApiClient> = {}): GrainApiClient {
  return {
    listRecordings: vi.fn().mockResolvedValue({
      recordings: [
        {
          id: 'rec-1',
          title: 'Weekly Sync',
          started_at: '2024-09-01T10:00:00Z',
          duration_ms: 1800000,
          participants: [{ name: 'Alice' }, { name: 'Bob' }],
          summary: 'Discussed roadmap.',
          updated_at: '2024-09-01T11:00:00Z',
        },
      ],
      nextCursor: undefined,
    }),
    getTranscript: vi.fn().mockResolvedValue([
      { speaker: 'Alice', start_ms: 0, end_ms: 5000, text: 'Hello.' },
      { speaker: 'Bob', start_ms: 5000, end_ms: 10000, text: 'Hi.' },
    ]),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunGrainSyncInput> = {}): RunGrainSyncInput {
  return {
    client: mockClient(),
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runGrainSync', () => {
  it('fetches recordings and enqueues chunks', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const result = await runGrainSync(baseInput({ enqueueEmbed }));
    expect(result.artifactCount).toBe(1);
    expect(enqueueEmbed).toHaveBeenCalledOnce();
    const call = enqueueEmbed.mock.calls[0]![0];
    expect(call.recordingId).toBe('rec-1');
    expect(call.chunks.length).toBeGreaterThan(0);
    expect(call.chunks[0].provider).toBe('grain');
  });

  it('skips already-seen content hashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    // First run — collect hashes.
    const existingHashes = new Set<string>();
    await runGrainSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).toHaveBeenCalledOnce();

    // Second run with same hashes — nothing new.
    enqueueEmbed.mockClear();
    await runGrainSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('tracks latestUpdatedAt from recordings', async () => {
    const result = await runGrainSync(baseInput());
    expect(result.latestUpdatedAt).toBe('2024-09-01T11:00:00Z');
  });

  it('passes updatedAfter to client.listRecordings', async () => {
    const client = mockClient();
    await runGrainSync(baseInput({ client, updatedAfter: '2024-08-01T00:00:00Z' }));
    expect(client.listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAfter: '2024-08-01T00:00:00Z' }),
    );
  });

  it('handles transcript fetch failure gracefully (warns, still ingests recording)', async () => {
    const warnings: string[] = [];
    const client = mockClient({
      getTranscript: vi.fn().mockRejectedValue(new Error('network error')),
    });
    const result = await runGrainSync(
      baseInput({ client, logger: { warn: (m) => warnings.push(m) } }),
    );
    expect(result.artifactCount).toBe(1);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('paginates: follows nextCursor', async () => {
    let call = 0;
    const client = mockClient({
      listRecordings: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            recordings: [
              {
                id: `rec-${call}`,
                title: 'Meeting A',
                started_at: '2024-09-01T10:00:00Z',
                duration_ms: 900000,
                participants: [],
                updated_at: '2024-09-01T10:30:00Z',
              },
            ],
            nextCursor: 'cursor-2',
          });
        }
        return Promise.resolve({
          recordings: [
            {
              id: `rec-${call}`,
              title: 'Meeting B',
              started_at: '2024-09-02T10:00:00Z',
              duration_ms: 900000,
              participants: [],
              updated_at: '2024-09-02T10:30:00Z',
            },
          ],
          nextCursor: undefined,
        });
      }),
    });
    const result = await runGrainSync(baseInput({ client }));
    expect(result.artifactCount).toBe(2);
  });

  it('returns zero artifactCount if no recordings and updatedAfter is set (no error)', async () => {
    const client = mockClient({
      listRecordings: vi.fn().mockResolvedValue({ recordings: [], nextCursor: undefined }),
    });
    const result = await runGrainSync(baseInput({ client, updatedAfter: '2024-09-01T00:00:00Z' }));
    expect(result.artifactCount).toBe(0);
  });
});
