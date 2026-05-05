// packages/discovery/src/discover.ts
import { clusterArtifacts } from './cluster.js';
import { proposeProcedureName, type ProposeInput } from './propose.js';
import { DEFAULT_CLUSTER_OPTIONS, type ArtifactInput, type Episode, type Proposal } from './types.js';

// ---------------------------------------------------------------------------
// DiscoveryDb adapter — callers supply a concrete implementation
// ---------------------------------------------------------------------------

export interface DiscoveryDb {
  /** Return artifacts fetched within the last `windowMs` milliseconds for the given org. */
  recentArtifactsForOrg(orgId: string, windowMs: number): Promise<ArtifactInput[]>;
  /** Return centroid embeddings of proposals that were rejected within the given lookback window. */
  recentRejectedCentroidsForOrg(orgId: string, lookbackMs: number): Promise<number[][]>;
  /** Persist an episode and return its generated id. */
  insertEpisode(orgId: string, episode: Episode): Promise<string>;
  /** Persist a proposal tied to an episode and return its generated id. */
  insertProposal(orgId: string, episodeId: string, proposal: Proposal): Promise<string>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoveryInput {
  orgId: string;
  apiKey: string;
  db: DiscoveryDb;
  /** Override the propose function for testing. Defaults to `proposeProcedureName`. */
  propose?: (input: ProposeInput) => Promise<Proposal>;
  /** Active clustering window in ms. Defaults to `DEFAULT_CLUSTER_OPTIONS.timeWindowMs`. */
  windowMs?: number;
}

export interface DiscoveryResult {
  episodesInserted: number;
  proposalsInserted: number;
  clustersSkipped: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Convert an artifact payload into a text string for the LLM. */
function payloadToText(payload: Record<string, unknown>): string {
  return Object.values(payload)
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
}

const REJECTION_SIMILARITY_THRESHOLD = 0.92;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runDiscovery(input: DiscoveryInput): Promise<DiscoveryResult> {
  const {
    orgId,
    apiKey,
    db,
    propose = proposeProcedureName,
    windowMs = DEFAULT_CLUSTER_OPTIONS.timeWindowMs,
  } = input;

  // 1. Load recent artifacts and rejected centroids in parallel.
  const [artifacts, rejectedCentroids] = await Promise.all([
    db.recentArtifactsForOrg(orgId, windowMs),
    db.recentRejectedCentroidsForOrg(orgId, windowMs * 4),
  ]);

  // Build a lookup map for artifact retrieval after clustering.
  const byId = new Map<string, ArtifactInput>(artifacts.map((a) => [a.id, a]));

  // 2. Cluster artifacts into episodes.
  const episodes = clusterArtifacts(artifacts, DEFAULT_CLUSTER_OPTIONS);

  let episodesInserted = 0;
  let proposalsInserted = 0;
  let clustersSkipped = 0;

  // 3. Process each cluster.
  for (const episode of episodes) {
    // Check rejection blocklist: skip if centroid is too similar to any rejected centroid.
    const isTooSimilar = rejectedCentroids.some(
      (rejected) => cosine(episode.centroidEmbedding, rejected) >= REJECTION_SIMILARITY_THRESHOLD,
    );

    if (isTooSimilar) {
      clustersSkipped++;
      continue;
    }

    // 4. Build artifact content for the LLM — limit to 5 artifacts.
    const sampleArtifacts = episode.artifactIds.slice(0, 5).map((id) => {
      const a = byId.get(id)!;
      return { kind: a.kind, content: payloadToText(a.payload) };
    });

    // 5. Propose a procedure name.
    const proposal = await propose({ apiKey, artifacts: sampleArtifacts });

    // 6. Persist episode then proposal.
    const episodeId = await db.insertEpisode(orgId, episode);
    episodesInserted++;

    await db.insertProposal(orgId, episodeId, proposal);
    proposalsInserted++;
  }

  return { episodesInserted, proposalsInserted, clustersSkipped };
}
