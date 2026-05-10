/**
 * Bridge between @holo/connector-framework specs and the worker's
 * existing SyncRunner / BullMQ topology.
 *
 * Implements RuntimeStores against Drizzle so a ConnectorSpec can run
 * inside the worker with no per-connector glue beyond `createGenericRunner(spec)`.
 *
 * What this owns:
 * - Drizzle queries that load tokens, read/write per-resource cursors, and
 *   load the org-scoped existing-content-hash set.
 * - Mapping the framework's ChunkRecord → the worker's ChunkInsertPayload
 *   shape that the embed pipeline already understands.
 * - Adapting framework's runConnectorSync → SyncRunner's full/incremental
 *   methods. Both methods invoke the same path; per-resource branching on
 *   first-vs-incremental is handled by each resource's cursor schema default.
 */
import { eq, and, desc } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import {
  runConnectorSync,
  type AllowlistEntry,
  type ChunkRecord,
  type ConnectorSpec,
  type ConnectorTokens,
  type RuntimeStores,
} from '@holo/connector-framework';
import {
  loadGithubInstallationToken,
  githubAppConfigFromEnv,
  loadGoogleServiceAccountToken,
  isGoogleServiceAccountProvider,
} from '@holo/connectors';
import type { SyncRunner, SyncResult } from './sync-dispatch';
import type { SyncJobPayload } from './types';
import type { EmbedJobPayload, ChunkInsertPayload } from './embed-insert';

export interface GenericRunnerDeps {
  db: DB;
  embedQueue: Queue<EmbedJobPayload>;
}

/**
 * Build a Drizzle-backed RuntimeStores for one (db, embedQueue) pair. Stateless
 * across syncs — every callback queries fresh. Cursor scope is the
 * framework resource id; each spec resource gets its own connector_cursors
 * row at scope = `<resource.id>` so resources can advance independently.
 */
export function createRuntimeStores(deps: GenericRunnerDeps): RuntimeStores {
  return {
    async loadTokens({ organizationId, providerId }): Promise<ConnectorTokens> {
      // GitHub auth lives in `github_installations`, not `connector_credentials` —
      // we mint a fresh installation access token on every sync via the App's
      // private key. The framework spec sees this as `tokens.accessToken` and
      // doesn't need to know about the installation flow.
      if (providerId === 'github') {
        const config = githubAppConfigFromEnv({
          GITHUB_APP_ID: process.env.GITHUB_APP_ID,
          GITHUB_APP_PRIVATE_KEY_B64: process.env.GITHUB_APP_PRIVATE_KEY_B64,
        });
        const { token } = await loadGithubInstallationToken({
          db: deps.db,
          organizationId,
          config,
        });
        return { accessToken: token };
      }

      // Mintlify and Zendesk Help Center use the framework's `none()` auth
      // strategy — public docs/help-center sites with no credential to load.
      // The per-source baseUrl lives on `sources.metadata` and is read by the
      // spec directly. Return an empty token so the framework's authHeader
      // no-op fires.
      if (providerId === 'mintlify' || providerId === 'zendesk') {
        return { accessToken: '' };
      }

      // Google Drive + Google Chat are backed by per-org service accounts
      // (connector_service_accounts) instead of per-user OAuth. We mint a
      // fresh delegated access token on every sync via Google's JWT bearer
      // flow — the helper signs a JWT with the SA private key and exchanges
      // it for a 1h token impersonating the Workspace user the admin chose
      // at install time. Tokens are cached in-process for ~50 minutes so
      // back-to-back syncs in the same worker incarnation don't re-mint.
      if (isGoogleServiceAccountProvider(providerId)) {
        const { accessToken, expiresAt } = await loadGoogleServiceAccountToken({
          db: deps.db,
          organizationId,
          provider: providerId,
        });
        return { accessToken, expiresAt };
      }

      const rows = await deps.db
        .select({
          accessToken: schema.connectorCredentials.accessToken,
          refreshToken: schema.connectorCredentials.refreshToken,
          scope: schema.connectorCredentials.scope,
          expiresAt: schema.connectorCredentials.expiresAt,
        })
        .from(schema.connectorCredentials)
        .where(
          and(
            eq(schema.connectorCredentials.organizationId, organizationId),
            // The provider column is a Drizzle TS-enum on a plain text column;
            // any spec id we register is castable as long as the schema array
            // includes it.
            eq(
              schema.connectorCredentials.provider,
              providerId as 'github' | 'gitlab' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear' | 'googledrive' | 'google-chat',
            ),
            eq(schema.connectorCredentials.status, 'active'),
          ),
        )
        .orderBy(desc(schema.connectorCredentials.connectedAt))
        .limit(1);

      const row = rows[0];
      if (!row?.accessToken) {
        throw holoError({
          code: ErrorCode.HOLO_AUTH_NO_SESSION,
          problem: `No active ${providerId} credential for organization ${organizationId}`,
          fix: `Connect ${providerId} via the OAuth flow before scheduling syncs.`,
        });
      }
      return {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken ?? undefined,
        scope: row.scope ?? undefined,
        expiresAt: row.expiresAt ?? undefined,
      };
    },

    async saveTokens({ organizationId, providerId, tokens }): Promise<void> {
      // Google SA tokens are minted on demand from connector_service_accounts;
      // there's nothing to persist on a "refresh". The bridge's loadTokens
      // returns a freshly-minted token on every sync, and the spec's apiKey
      // strategy is refreshable=false so this branch shouldn't normally fire.
      if (isGoogleServiceAccountProvider(providerId)) return;
      // GitHub installation tokens are minted per-call inside
      // loadGithubInstallationToken's cache; we never persist them.
      if (providerId === 'github') return;
      await deps.db
        .update(schema.connectorCredentials)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          scope: tokens.scope ?? null,
          expiresAt: tokens.expiresAt ?? null,
          lastRefreshedAt: new Date(),
        })
        .where(
          and(
            eq(schema.connectorCredentials.organizationId, organizationId),
            eq(
              schema.connectorCredentials.provider,
              providerId as 'github' | 'gitlab' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear' | 'googledrive' | 'google-chat',
            ),
            eq(schema.connectorCredentials.status, 'active'),
          ),
        );
    },

    async loadCursor({ sourceId, resourceId }): Promise<unknown | undefined> {
      const rows = await deps.db
        .select({ metadata: schema.connectorCursors.metadata })
        .from(schema.connectorCursors)
        .where(
          and(
            eq(schema.connectorCursors.sourceId, sourceId),
            eq(schema.connectorCursors.scope, resourceId),
          ),
        )
        .limit(1);
      return rows[0]?.metadata;
    },

    async saveCursor({ organizationId, sourceId, resourceId, cursor }): Promise<void> {
      const metadata = (cursor ?? {}) as Record<string, unknown>;
      // Manual upsert — the framework intentionally avoids tying itself to a
      // particular dialect's onConflict syntax. Drizzle does the rest.
      const existing = await deps.db
        .select({ id: schema.connectorCursors.id })
        .from(schema.connectorCursors)
        .where(
          and(
            eq(schema.connectorCursors.sourceId, sourceId),
            eq(schema.connectorCursors.scope, resourceId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await deps.db
          .update(schema.connectorCursors)
          .set({ metadata })
          .where(eq(schema.connectorCursors.id, existing[0].id));
      } else {
        await deps.db.insert(schema.connectorCursors).values({
          organizationId,
          sourceId,
          scope: resourceId,
          metadata,
        });
      }
    },

    async loadExistingHashes({ organizationId }): Promise<Set<string>> {
      const rows = await deps.db
        .select({ contentHash: schema.chunks.contentHash })
        .from(schema.chunks)
        .where(eq(schema.chunks.organizationId, organizationId));
      return new Set(rows.map((r) => r.contentHash));
    },

    async loadSourceMetadata({ sourceId }): Promise<Record<string, unknown>> {
      const rows = await deps.db
        .select({ metadata: schema.sources.metadata })
        .from(schema.sources)
        .where(eq(schema.sources.id, sourceId))
        .limit(1);
      const meta = rows[0]?.metadata;
      if (!meta || typeof meta !== 'object') return {};
      return meta as Record<string, unknown>;
    },

    async loadAllowlist({ organizationId, providerId }): Promise<ReadonlyArray<AllowlistEntry>> {
      const rows = await deps.db
        .select({
          pattern: schema.connectorAllowlists.pattern,
          patternKind: schema.connectorAllowlists.patternKind,
          decision: schema.connectorAllowlists.decision,
        })
        .from(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.organizationId, organizationId),
            eq(
              schema.connectorAllowlists.provider,
              providerId as 'github' | 'slack' | 'notion',
            ),
          ),
        );
      return rows;
    },

    async enqueueChunks({ organizationId, chunks }): Promise<void> {
      if (chunks.length === 0) return;
      const payload: ChunkInsertPayload[] = chunks.map(toChunkInsertPayload);
      await deps.embedQueue.add('embed', {
        chunks: payload,
        organizationId,
        sourceArtifactId: chunks[0]?.sourceArtifactId ?? '',
      });
    },
  };
}

function toChunkInsertPayload(c: ChunkRecord): ChunkInsertPayload {
  return {
    kind: c.kind,
    content: c.content,
    metadata: c.metadata,
    aclSubjects: c.aclSubjects,
    organizationId: c.organizationId,
    sourceId: c.sourceId,
    sourceArtifactId: c.sourceArtifactId,
    provider: c.provider,
    contentHash: c.contentHash,
  };
}

/**
 * Single SyncRunner factory for any framework spec. Both `full` and
 * `incremental` invoke runConnectorSync — full vs. incremental decisions
 * live in each resource's cursor (presence of fields like `updatedAt`),
 * not at the runner level. After Phase 4 every connector registers
 * through this one factory; there are no per-connector createXxxRunner
 * functions in the worker.
 */
export interface CreateGenericRunnerOptions {
  /**
   * Run only these resource ids. Used by hosts that map one spec across
   * multiple BullMQ queues (e.g. GitHub: github-prose-sync runs `prose`,
   * github-code-sync runs `code`). When omitted, every resource runs.
   */
  resources?: ReadonlyArray<string>;
  /** Optional adapter for the github-code-sync queue's `codeInitial`/`codeIncremental` methods. */
  shape?: 'standard' | 'code';
}

export function createGenericRunner(
  spec: ConnectorSpec,
  deps: GenericRunnerDeps,
  opts: CreateGenericRunnerOptions = {},
): SyncRunner {
  const stores = createRuntimeStores(deps);
  const run = async (
    payload: SyncJobPayload,
    runOpts?: { signal?: AbortSignal },
  ): Promise<SyncResult> => {
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: payload.organizationId,
      sourceId: payload.sourceId,
      signal: runOpts?.signal,
      resources: opts.resources,
    });
    return {
      artifactCount: result.artifactCount,
      // The dispatcher writes one summary row at scope='sync' on top of the
      // per-resource rows we already wrote inside the runtime; using `now()`
      // here keeps the existing dashboard "last run" view correct without
      // forcing the runtime to invent a single timestamp across resources.
      newCursor: new Date(),
      // Keep the per-resource cursor map on the summary row's metadata so
      // operators can eyeball it without joining cursor rows.
      metadataPatch: result.cursorPatch,
      breakdown: result.breakdown,
    };
  };

  // The dispatcher selects between full/incremental and codeInitial/codeIncremental
  // based on the queue. For the github-code-sync queue we expose the code-*
  // methods; for everything else, full + incremental. Both delegate to `run`
  // since the framework runtime decides per-resource what to do.
  if (opts.shape === 'code') {
    return {
      codeInitial: (payload, runOpts) => run(payload, runOpts),
      codeIncremental: (payload, _cursor, runOpts) => run(payload, runOpts),
    };
  }
  return {
    full: (payload, runOpts) => run(payload, runOpts),
    incremental: (payload, _cursor, runOpts) => run(payload, runOpts),
  };
}
