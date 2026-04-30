import type { Sql } from 'postgres';
import type { SyncCursor } from './types';

export type SyncCursorStore = {
  read(sourceId: string): Promise<SyncCursor>;
  upsertAfterSync(
    sourceId: string,
    args: {
      latestSeenTs: Date | null;
      status: string;
      metadataPatch?: Record<string, unknown>;
    },
  ): Promise<void>;
};

const SYNC_SCOPE = 'sync';

export function createPostgresSyncCursorStore(sql: Sql): SyncCursorStore {
  return {
    async read(sourceId) {
      const rows = await sql<
        { metadata: Record<string, unknown>; latest_seen_ts: Date | null }[]
      >`
        SELECT metadata, latest_seen_ts
          FROM connector_cursors
         WHERE source_id = ${sourceId} AND scope = ${SYNC_SCOPE}
         LIMIT 1
      `;
      if (rows.length === 0) {
        return { exists: false, metadata: {}, latestSeenTs: null };
      }
      const r = rows[0]!;
      return { exists: true, metadata: r.metadata ?? {}, latestSeenTs: r.latest_seen_ts };
    },
    async upsertAfterSync(sourceId, args) {
      const patchJson = JSON.stringify(args.metadataPatch ?? {});
      await sql`
        INSERT INTO connector_cursors
          (organization_id, source_id, scope, latest_seen_ts, last_run_at, last_status, metadata)
        SELECT s.organization_id, s.id, ${SYNC_SCOPE}, ${args.latestSeenTs},
               NOW(), ${args.status}, ${patchJson}::jsonb
          FROM sources s
         WHERE s.id = ${sourceId}
        ON CONFLICT (source_id, scope) DO UPDATE
           SET latest_seen_ts = EXCLUDED.latest_seen_ts,
               last_run_at = NOW(),
               last_status = EXCLUDED.last_status,
               metadata = connector_cursors.metadata || EXCLUDED.metadata
      `;
    },
  };
}

export function createInMemorySyncCursorStore(): SyncCursorStore & {
  cursors: Map<string, SyncCursor>;
} {
  const cursors = new Map<string, SyncCursor>();
  return {
    cursors,
    async read(sourceId) {
      return cursors.get(sourceId) ?? { exists: false, metadata: {}, latestSeenTs: null };
    },
    async upsertAfterSync(sourceId, args) {
      const prev = cursors.get(sourceId) ?? { exists: false, metadata: {}, latestSeenTs: null };
      cursors.set(sourceId, {
        exists: true,
        metadata: { ...prev.metadata, ...(args.metadataPatch ?? {}) },
        latestSeenTs: args.latestSeenTs,
      });
    },
  };
}
