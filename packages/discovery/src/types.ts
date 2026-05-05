export interface ArtifactInput {
  id: string;
  sourceId: string;
  externalId: string;
  kind: string;
  payload: Record<string, unknown>;
  fetchedAt: Date;
  embedding: number[] | null;
  entityHints: string[];
}

export interface Episode {
  artifactIds: string[];
  centroidEmbedding: number[];
  entityKey: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface Proposal {
  proposedSlug: string;
  proposedName: string;
  summary: string;
}

export interface ClusterOptions {
  minArtifacts: number;
  minDistinctSources: number;
  similarityThreshold: number;
  timeWindowMs: number;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = {
  minArtifacts: 3,
  minDistinctSources: 1,
  similarityThreshold: 0.7,
  timeWindowMs: 1000 * 60 * 60 * 24 * 14,
};
