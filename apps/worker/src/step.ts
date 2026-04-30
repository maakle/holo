import type { Sql } from 'postgres';

export type CheckpointRecord = {
  name: string;
  result: unknown;
  completedAt: string;
};

export type CheckpointStore = {
  read(sourceId: string, jobId: string, name: string): Promise<CheckpointRecord | null>;
  write(sourceId: string, jobId: string, name: string, record: CheckpointRecord): Promise<void>;
};

export type StepArgs<T> = {
  store: CheckpointStore;
  sourceId: string;
  jobId: string;
  name: string;
  run: () => Promise<T>;
};

export async function step<T>(args: StepArgs<T>): Promise<T> {
  const existing = await args.store.read(args.sourceId, args.jobId, args.name);
  if (existing) {
    return existing.result as T;
  }
  const result = await args.run();
  await args.store.write(args.sourceId, args.jobId, args.name, {
    name: args.name,
    result,
    completedAt: new Date().toISOString(),
  });
  return result;
}

// In-memory implementation used in tests and as a reference for the contract.
export function createInMemoryCheckpointStore(): CheckpointStore & {
  dump(): Record<string, Record<string, Record<string, CheckpointRecord>>>;
} {
  // Shape: sourceId -> jobId -> name -> record
  const data: Record<string, Record<string, Record<string, CheckpointRecord>>> = {};
  return {
    async read(sourceId, jobId, name) {
      return data[sourceId]?.[jobId]?.[name] ?? null;
    },
    async write(sourceId, jobId, name, record) {
      data[sourceId] ??= {};
      data[sourceId][jobId] ??= {};
      data[sourceId][jobId][name] = record;
    },
    dump() {
      return data;
    },
  };
}

// Postgres implementation: persists into connector_cursors.metadata.checkpoints.<jobId>.<name>
// keyed by (sourceId, scope='checkpoints'). Single UPDATE per write so a crash mid-write
// can't corrupt half a checkpoint.
export function createPostgresCheckpointStore(sql: Sql): CheckpointStore {
  return {
    async read(sourceId, jobId, name) {
      const rows = await sql<{ ckpt: CheckpointRecord | null }[]>`
        SELECT metadata #> ${sql.array(['checkpoints', jobId, name], 1009)} AS ckpt
          FROM connector_cursors
         WHERE source_id = ${sourceId} AND scope = 'checkpoints'
         LIMIT 1
      `;
      return rows[0]?.ckpt ?? null;
    },
    async write(sourceId, jobId, name, record) {
      const recordJson = JSON.stringify(record);
      const jobPath = sql.array(['checkpoints', jobId], 1009);
      const fullPath = sql.array(['checkpoints', jobId, name], 1009);
      // Single statement: upsert the (source_id, scope='checkpoints') row and
      // jsonb_set the deep path in one UPDATE. create_missing=true ensures
      // intermediate keys are created. Wrapping with the inner jsonb_set on
      // the parent path guarantees the {jobId: {}} object exists before the
      // leaf write so the path is reachable.
      await sql`
        INSERT INTO connector_cursors (organization_id, source_id, scope, metadata)
        SELECT s.organization_id, s.id, 'checkpoints',
               jsonb_set(
                 jsonb_set('{}'::jsonb, ${jobPath}, '{}'::jsonb, true),
                 ${fullPath},
                 ${recordJson}::jsonb,
                 true
               )
          FROM sources s
         WHERE s.id = ${sourceId}
        ON CONFLICT (source_id, scope) DO UPDATE
           SET metadata = jsonb_set(
             jsonb_set(
               connector_cursors.metadata,
               ${jobPath},
               COALESCE(connector_cursors.metadata #> ${jobPath}, '{}'::jsonb),
               true
             ),
             ${fullPath},
             ${recordJson}::jsonb,
             true
           )
      `;
    },
  };
}
