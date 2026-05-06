// packages/discovery/src/__tests__/discover.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runDiscovery, type DiscoveryDb, type DiscoveryInput } from '../discover.js';
import type { ProposeInput } from '../propose.js';
import type { ArtifactInput, Proposal } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseEmbedding = (i: number): number[] => {
  const v = new Array(1024).fill(0);
  v[i] = 1;
  return v;
};

const NOW = new Date('2026-05-01T10:00:00Z');

const artifact = (overrides: Partial<ArtifactInput>): ArtifactInput => ({
  id: 'a',
  sourceId: 's1',
  externalId: 'ext',
  kind: 'hubspot.deal',
  payload: { title: 'test artifact' },
  fetchedAt: NOW,
  embedding: baseEmbedding(0),
  entityHints: ['deal:42'],
  ...overrides,
});

const mockPropose = vi.fn<(input: ProposeInput) => Promise<Proposal>>();

function makeDb(
  artifacts: ArtifactInput[],
  rejectedCentroids: number[][] = [],
): DiscoveryDb {
  return {
    recentArtifactsForOrg: vi.fn().mockResolvedValue(artifacts),
    recentRejectedCentroidsForOrg: vi.fn().mockResolvedValue(rejectedCentroids),
    insertEpisode: vi.fn().mockResolvedValue('ep-1'),
    insertProposal: vi.fn().mockResolvedValue('prop-1'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDiscovery', () => {
  it('inserts episode + proposal for a clusterable bundle', async () => {
    const artifacts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:42'] }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:42'], embedding: baseEmbedding(1) }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:42'], embedding: baseEmbedding(2) }),
    ];
    const db = makeDb(artifacts);

    const proposal: Proposal = {
      proposedSlug: 'close-enterprise-deal',
      proposedName: 'Close Enterprise Deal',
      summary: 'Runs when an enterprise deal is being negotiated and closed.',
    };
    mockPropose.mockResolvedValue(proposal);

    const input: DiscoveryInput = {
      orgId: 'org-1',
      apiKey: 'test-key',
      db,
      propose: mockPropose,
    };

    const result = await runDiscovery(input);

    expect(db.recentArtifactsForOrg).toHaveBeenCalledWith('org-1', expect.any(Number));
    expect(db.recentRejectedCentroidsForOrg).toHaveBeenCalledWith('org-1', expect.any(Number));
    expect(db.insertEpisode).toHaveBeenCalledTimes(1);
    expect(db.insertProposal).toHaveBeenCalledTimes(1);
    expect(result.episodesInserted).toBe(1);
    expect(result.proposalsInserted).toBe(1);
    expect(result.clustersSkipped).toBe(0);
  });

  it('skips clusters whose centroid is too similar to a recently-rejected proposal centroid', async () => {
    // All artifacts share the same embedding direction so centroid ≈ baseEmbedding(0)
    const sharedEmb = baseEmbedding(0);
    const artifacts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:42'], embedding: sharedEmb }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:42'], embedding: sharedEmb }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:42'], embedding: sharedEmb }),
    ];
    // Rejected centroid is identical to baseEmbedding(0) → cosine = 1.0 ≥ 0.92
    const rejectedCentroids = [sharedEmb];
    const db = makeDb(artifacts, rejectedCentroids);

    mockPropose.mockClear();

    const input: DiscoveryInput = {
      orgId: 'org-1',
      apiKey: 'test-key',
      db,
      propose: mockPropose,
    };

    const result = await runDiscovery(input);

    expect(mockPropose).not.toHaveBeenCalled();
    expect(db.insertEpisode).not.toHaveBeenCalled();
    expect(db.insertProposal).not.toHaveBeenCalled();
    expect(result.episodesInserted).toBe(0);
    expect(result.proposalsInserted).toBe(0);
    expect(result.clustersSkipped).toBe(1);
  });
});
