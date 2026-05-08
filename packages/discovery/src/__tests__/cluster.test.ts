// packages/discovery/src/__tests__/cluster.test.ts
import { describe, it, expect } from 'vitest';
import { clusterArtifacts } from '../cluster';
import { DEFAULT_CLUSTER_OPTIONS, type ArtifactInput } from '../types';

const baseEmbedding = (i: number) => {
  const v = new Array(1024).fill(0);
  v[i] = 1;
  return v;
};

const artifact = (overrides: Partial<ArtifactInput>): ArtifactInput => ({
  id: 'a',
  sourceId: 's1',
  externalId: 'ext',
  kind: 'hubspot.deal',
  payload: {},
  fetchedAt: new Date('2026-05-01T10:00:00Z'),
  embedding: baseEmbedding(0),
  entityHints: [],
  ...overrides,
});

describe('clusterArtifacts', () => {
  it('returns no episodes when below minArtifacts', () => {
    const arts = [artifact({ id: 'a' })];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps).toEqual([]);
  });

  it('groups artifacts that share an entity hint across distinct sources', () => {
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:42'] }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:42'], embedding: baseEmbedding(500) }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:42'], embedding: baseEmbedding(900) }),
    ];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.artifactIds.sort()).toEqual(['a', 'b', 'c']);
    expect(eps[0]!.entityKey).toBe('deal:42');
  });

  it('rejects clusters that come from only one source when minDistinctSources >= 2', () => {
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:7'] }),
      artifact({ id: 'b', sourceId: 's1', entityHints: ['deal:7'] }),
      artifact({ id: 'c', sourceId: 's1', entityHints: ['deal:7'] }),
    ];
    const eps = clusterArtifacts(arts, { ...DEFAULT_CLUSTER_OPTIONS, minDistinctSources: 2 });
    expect(eps).toEqual([]);
  });

  it('groups by embedding similarity when no entity hints exist', () => {
    const close = baseEmbedding(0);
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', embedding: close }),
      artifact({ id: 'b', sourceId: 's2', embedding: close }),
      artifact({ id: 'c', sourceId: 's3', embedding: close }),
    ];
    const eps = clusterArtifacts(arts, { ...DEFAULT_CLUSTER_OPTIONS, similarityThreshold: 0.5 });
    expect(eps).toHaveLength(1);
    expect(eps[0]!.artifactIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not merge artifacts outside the time window', () => {
    // 'a' is far in the past; 'b', 'c', 'd' are within window of each other.
    // Resulting cluster contains b+c+d, never 'a'.
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['deal:9'], fetchedAt: new Date('2026-01-01') }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['deal:9'], fetchedAt: new Date('2026-05-01') }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['deal:9'], fetchedAt: new Date('2026-05-02') }),
      artifact({ id: 'd', sourceId: 's4', entityHints: ['deal:9'], fetchedAt: new Date('2026-05-03') }),
    ];
    const eps = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.artifactIds.sort()).toEqual(['b', 'c', 'd']);
    expect(eps[0]!.artifactIds).not.toContain('a');
  });

  it('computes a centroid embedding as the element-wise mean', () => {
    const e1 = new Array(1024).fill(0); e1[0] = 1;
    const e2 = new Array(1024).fill(0); e2[0] = 0.5;
    const e3 = new Array(1024).fill(0); e3[0] = 0.3;
    const arts: ArtifactInput[] = [
      artifact({ id: 'a', sourceId: 's1', entityHints: ['x'], embedding: e1 }),
      artifact({ id: 'b', sourceId: 's2', entityHints: ['x'], embedding: e2 }),
      artifact({ id: 'c', sourceId: 's3', entityHints: ['x'], embedding: e3 }),
    ];
    const [ep] = clusterArtifacts(arts, DEFAULT_CLUSTER_OPTIONS);
    expect(ep!.centroidEmbedding[0]).toBeCloseTo(0.6, 5);
  });
});
