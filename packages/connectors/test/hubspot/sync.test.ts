import { describe, it, expect, vi } from 'vitest';
import { runHubspotSync, type RunHubspotSyncInput } from '../../src/hubspot/sync';
import type {
  HubspotApiClient,
  HubspotEngagement,
  HubspotRecord,
} from '../../src/hubspot/api-client';

function makeRecord(overrides: Partial<HubspotRecord> = {}): HubspotRecord {
  return {
    id: 'r-1',
    properties: { dealname: 'Acme Renewal', dealstage: 'won', amount: '10000' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

function makeEngagement(overrides: Partial<HubspotEngagement> = {}): HubspotEngagement {
  return {
    id: 'eng-1',
    engagementType: 'note',
    createdAt: '2026-01-15T00:00:00Z',
    body: 'Discussed Q4 renewal terms.',
    ...overrides,
  };
}

function mockClient(overrides: Partial<HubspotApiClient> = {}): HubspotApiClient {
  return {
    listRecords: vi.fn().mockImplementation((objectType: string) => {
      if (objectType === 'deals') {
        return Promise.resolve({ results: [makeRecord()], nextAfter: undefined });
      }
      return Promise.resolve({ results: [], nextAfter: undefined });
    }),
    getEngagementsForRecord: vi.fn().mockResolvedValue([makeEngagement()]),
    testConnection: vi.fn().mockResolvedValue({ id: 'hub-1', name: 'Test Hub' }),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunHubspotSyncInput> = {}): RunHubspotSyncInput {
  return {
    client: mockClient(),
    cursor: {},
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    objectTypes: ['deals'],
    ...overrides,
  };
}

describe('runHubspotSync', () => {
  it('fetches records and enqueues record + engagement chunks', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const result = await runHubspotSync(baseInput({ enqueueEmbed }));

    expect(result.artifactCount).toBe(1);
    expect(enqueueEmbed).toHaveBeenCalledOnce();
    const call = enqueueEmbed.mock.calls[0]![0];
    expect(call.recordId).toBe('r-1');
    expect(call.recordType).toBe('deal');
    expect(call.chunks.length).toBe(2);
    expect(call.chunks[0].kind).toBe('hubspot-deal');
    expect(call.chunks[1].kind).toBe('hubspot-engagement');
    expect(call.chunks[0].provider).toBe('hubspot');
  });

  it('iterates all three object types by default', async () => {
    const listRecords = vi
      .fn()
      .mockResolvedValue({ results: [], nextAfter: undefined });
    const client = mockClient({ listRecords });
    const result = await runHubspotSync(
      baseInput({ client, objectTypes: undefined }),
    );
    expect(listRecords).toHaveBeenCalledWith('contacts', expect.anything());
    expect(listRecords).toHaveBeenCalledWith('deals', expect.anything());
    expect(listRecords).toHaveBeenCalledWith('companies', expect.anything());
    expect(result.artifactCount).toBe(0);
  });

  it('paginates within a single object type via nextAfter', async () => {
    let call = 0;
    const client = mockClient({
      listRecords: vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            results: [makeRecord({ id: 'r-1' })],
            nextAfter: 'cursor-2',
          });
        }
        return Promise.resolve({
          results: [makeRecord({ id: 'r-2', updatedAt: '2026-03-01T00:00:00Z' })],
          nextAfter: undefined,
        });
      }),
    });
    const result = await runHubspotSync(baseInput({ client }));
    expect(result.artifactCount).toBe(2);
  });

  it('passes updatedAfter from cursor to listRecords', async () => {
    const client = mockClient();
    await runHubspotSync(
      baseInput({ client, cursor: { deals: '2026-01-01T00:00:00Z' } }),
    );
    expect(client.listRecords).toHaveBeenCalledWith(
      'deals',
      expect.objectContaining({ updatedAfter: '2026-01-01T00:00:00Z' }),
    );
  });

  it('persists newCursor watermark per object type', async () => {
    const result = await runHubspotSync(baseInput());
    expect(result.newCursor.deals).toBe('2026-02-01T00:00:00Z');
  });

  it('skips already-seen content hashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const existingHashes = new Set<string>();
    await runHubspotSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).toHaveBeenCalledOnce();

    enqueueEmbed.mockClear();
    await runHubspotSync(baseInput({ enqueueEmbed, existingHashes }));
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('continues if engagement fetch fails for a record', async () => {
    const warnings: string[] = [];
    const client = mockClient({
      getEngagementsForRecord: vi.fn().mockRejectedValue(new Error('rate limit')),
    });
    const result = await runHubspotSync(
      baseInput({ client, logger: { warn: (m) => warnings.push(m) } }),
    );
    expect(result.artifactCount).toBe(1);
    expect(warnings.some((w) => w.includes('engagements'))).toBe(true);
  });

  it('continues to other object types if one list call fails', async () => {
    const warnings: string[] = [];
    const client = mockClient({
      listRecords: vi.fn().mockImplementation((ot: string) => {
        if (ot === 'contacts') {
          return Promise.reject(new Error('hubspot down'));
        }
        return Promise.resolve({ results: [makeRecord()], nextAfter: undefined });
      }),
    });
    const result = await runHubspotSync(
      baseInput({
        client,
        objectTypes: ['contacts', 'deals'],
        logger: { warn: (m) => warnings.push(m) },
      }),
    );
    expect(result.artifactCount).toBe(1);
    expect(warnings.some((w) => w.includes('contacts'))).toBe(true);
  });

  it('returns zero artifactCount when no records', async () => {
    const client = mockClient({
      listRecords: vi.fn().mockResolvedValue({ results: [], nextAfter: undefined }),
    });
    const result = await runHubspotSync(baseInput({ client }));
    expect(result.artifactCount).toBe(0);
  });
});
