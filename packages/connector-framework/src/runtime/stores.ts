import type { ConnectorTokens } from '../types';

/**
 * Persistence boundary between the framework and the host app. The framework
 * does not import `@holo/db`; the worker (or any host) implements these
 * callbacks against the actual schema.
 */
export interface RuntimeStores {
  /**
   * Load the active tokens for `(organizationId, providerId)`.
   * For githubApp connectors, the worker's implementation should mint a
   * fresh installation token here and return it as `accessToken`.
   */
  loadTokens(input: { organizationId: string; providerId: string }): Promise<ConnectorTokens>;

  /**
   * Persist tokens after a refresh. Optional — only needed for refreshable
   * OAuth strategies. No-op for apiKey and githubApp.
   */
  saveTokens?(input: {
    organizationId: string;
    providerId: string;
    tokens: ConnectorTokens;
  }): Promise<void>;

  /**
   * Load the cursor JSONB for one resource. Returns `undefined` if no row
   * exists yet (first sync) — the framework will use the schema default.
   */
  loadCursor(input: {
    sourceId: string;
    resourceId: string;
  }): Promise<unknown | undefined>;

  /** Persist the new cursor for a resource. */
  saveCursor(input: {
    organizationId: string;
    sourceId: string;
    resourceId: string;
    cursor: unknown;
  }): Promise<void>;

  /**
   * Bulk-load already-indexed content hashes for the org so the runtime can
   * dedupe new chunks before enqueueing. Called once per sync.
   */
  loadExistingHashes(input: { organizationId: string }): Promise<Set<string>>;

  /**
   * Hand chunks off to the embed pipeline. Called by the runtime in batches.
   */
  enqueueChunks(input: {
    organizationId: string;
    sourceId: string;
    chunks: ReadonlyArray<ChunkRecord>;
  }): Promise<void>;
}

/**
 * Internal shape the runtime emits to `enqueueChunks`. Mirrors the existing
 * per-connector ChunkPayload but stays generic — providers can extend
 * `metadata` for their own fields.
 */
export interface ChunkRecord {
  externalId: string;
  kind: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  /** `${spec.id}-${kind}:${externalId}` — derived by the runtime. */
  sourceArtifactId: string;
  /** Connector id (e.g. 'slack', 'linear'). */
  provider: string;
  organizationId: string;
  sourceId: string;
}

export interface SyncJobInput {
  organizationId: string;
  sourceId: string;
}

export interface SyncJobResult {
  artifactCount: number;
  /** Per-resource cursor patch, keyed by resource id. */
  cursorPatch: Record<string, unknown>;
  /** Resources that ran but had nothing new; reported for observability. */
  emptyResources?: ReadonlyArray<string>;
}
