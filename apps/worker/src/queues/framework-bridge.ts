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
              providerId as 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear',
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
              providerId as 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear',
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
 * not at the runner level. This collapses the per-connector runners
 * (createSlackRunner, createNotionRunner, etc.) into one generic call site.
 */
export function createGenericRunner(
  spec: ConnectorSpec,
  deps: GenericRunnerDeps,
): SyncRunner {
  const stores = createRuntimeStores(deps);
  const run = async (payload: SyncJobPayload, opts?: { signal?: AbortSignal }): Promise<SyncResult> => {
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: payload.organizationId,
      sourceId: payload.sourceId,
      signal: opts?.signal,
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
    };
  };

  return {
    full: (payload, opts) => run(payload, opts),
    incremental: (payload, _cursor, opts) => run(payload, opts),
  };
}
