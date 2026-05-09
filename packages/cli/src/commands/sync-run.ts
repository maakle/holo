import { and, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import {
  QUEUE_NAMES_BY_PROVIDER,
  SYNC_PROVIDERS,
  isSyncProvider,
  type SyncProvider,
} from '@holo/sync-providers';

export { SYNC_PROVIDERS, isSyncProvider };
export type { SyncProvider };

function parseRedisUrl(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

export interface SourceRow {
  id: string;
  name: string;
}

export interface EnqueueArgs {
  queueName: string;
  payload: { sourceId: string; organizationId: string };
}

export interface RunSyncInput {
  db: DB;
  organizationId: string;
  provider: string;
  redisUrl: string;
  /** Test seam: replaces the default BullMQ-backed enqueue with a stub. */
  enqueue?: (args: EnqueueArgs) => Promise<void>;
}

export interface RunSyncOutput {
  provider: SyncProvider;
  sources: SourceRow[];
  queueNames: string[];
  jobsEnqueued: number;
}

export async function runSync(input: RunSyncInput): Promise<RunSyncOutput> {
  if (!isSyncProvider(input.provider)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `unknown provider '${input.provider}'`,
      fix: `Use one of: ${SYNC_PROVIDERS.join(', ')}.`,
    });
  }
  const provider: SyncProvider = input.provider;
  const queueNames = QUEUE_NAMES_BY_PROVIDER[provider];

  const sources: SourceRow[] = await input.db
    .select({ id: schema.sources.id, name: schema.sources.name })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, input.organizationId),
        eq(schema.sources.provider, provider),
      ),
    );

  if (sources.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `no ${provider} sources found for organization ${input.organizationId}`,
      fix: `Connect ${provider} first (e.g. \`holo connect ${provider} …\` or via the web app), then re-run.`,
    });
  }

  // Default enqueue path: open one BullMQ Queue per name, push, close.
  // The test seam (input.enqueue) lets us assert wiring without Redis.
  let enqueue = input.enqueue;
  const opened: Queue[] = [];
  if (!enqueue) {
    const connection = parseRedisUrl(input.redisUrl);
    const queues = new Map<string, Queue>();
    enqueue = async ({ queueName, payload }) => {
      let q = queues.get(queueName);
      if (!q) {
        q = new Queue(queueName, { connection });
        queues.set(queueName, q);
        opened.push(q);
      }
      await q.add('sync', payload, { removeOnComplete: 100, removeOnFail: 100 });
    };
  }

  let jobsEnqueued = 0;
  try {
    for (const source of sources) {
      for (const queueName of queueNames) {
        await enqueue({
          queueName,
          payload: { sourceId: source.id, organizationId: input.organizationId },
        });
        jobsEnqueued += 1;
      }
    }
  } finally {
    for (const q of opened) {
      // Don't let a Redis disconnect mask a real error from the loop above.
      try { await q.close(); } catch { /* best-effort */ }
    }
  }

  return { provider, sources, queueNames: [...queueNames], jobsEnqueued };
}
