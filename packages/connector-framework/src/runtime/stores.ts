import type { AllowlistEntry, ConnectorTokens } from '../types';

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
   * Optional. Serialize the load → refresh → save sequence across concurrent
   * sync jobs that share `(organizationId, providerId)` — e.g. GitLab's
   * prose-queue and code-queue firing at the same minute. Hosts implement
   * this with a database-level advisory lock so workers in different
   * processes serialize too. The runtime calls `fn` inside the critical
   * section; `fn` is expected to re-read tokens (since another waiter may
   * have just refreshed), and only call `auth.refresh()` if still needed.
   *
   * Hosts that don't supply this fall back to no locking — fine for
   * single-worker test setups but unsafe in production for providers that
   * rotate refresh tokens (GitLab, Slack, etc.).
   */
  withAuthLock?<T>(
    input: { organizationId: string; providerId: string },
    fn: () => Promise<T>,
  ): Promise<T>;

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
   * Optional. Load the host's allowlist rows for (org, provider). Specs
   * that need narrowing (Slack, GitHub, Notion) read this from
   * `ctx.allowlist`. Hosts that don't expose an allowlist mechanism omit
   * this and the runtime hands specs an empty array.
   */
  loadAllowlist?(input: {
    organizationId: string;
    providerId: string;
  }): Promise<ReadonlyArray<AllowlistEntry>>;

  /**
   * Optional. Load the per-source `metadata` JSONB from the host's sources
   * table. Specs that key per-source state on the source row itself
   * (Mintlify: docs base URL; in the future: any multi-source spec) read
   * this from `ctx.sourceMetadata`. Hosts return an empty object when
   * no metadata is present.
   */
  loadSourceMetadata?(input: {
    sourceId: string;
  }): Promise<Record<string, unknown>>;

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

/**
 * Per-kind tally of what one sync run did. `new` is the chunk count newly
 * inserted; `deduped` is the count dropped because the same content_hash
 * already existed for the org (cross-sync rediscovery + intra-sync
 * duplicates). Sum of `new` across kinds equals the run's `artifactCount`.
 */
export type SyncBreakdown = Record<string, { new: number; deduped: number }>;

export interface SyncJobResult {
  artifactCount: number;
  /** Per-resource cursor patch, keyed by resource id. */
  cursorPatch: Record<string, unknown>;
  /** Resources that ran but had nothing new; reported for observability. */
  emptyResources?: ReadonlyArray<string>;
  /** Per-kind { new, deduped } counters from the upsert path. */
  breakdown: SyncBreakdown;
}
