import 'server-only';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import {
  DISCONNECT_CLEANUP_QUEUE,
  QUEUE_NAMES_BY_PROVIDER,
  SYNC_PROVIDERS,
  SYNC_PROVIDERS_FIX_HINT,
  isSyncProvider,
  type DisconnectCleanupJobPayload,
  type SyncProvider,
} from '@holo/sync-providers';

export { SYNC_PROVIDERS, SYNC_PROVIDERS_FIX_HINT, isSyncProvider };
export type Provider = SyncProvider;

function parseRedisUrl(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

const queues = new Map<string, Queue>();

function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: parseRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6382'),
    });
    queues.set(name, q);
  }
  return q;
}

/**
 * Check if a job for this (queue, sourceId) is already in-flight. We walk
 * waiting + active + delayed; completed/failed don't count. Avoids the
 * "click Save 3× → 3 concurrent workers chewing the same scope" footgun
 * that surfaces as duplicate sync rows in the manage sheet.
 *
 * BullMQ's jobId-based dedup only covers waiting/delayed (active jobs are
 * removed from the index), so this scan is necessary to also catch the
 * common case of "a worker is already running, don't pile on."
 *
 * `delayed` is tricky: it includes both retry-with-backoff *and* the
 * recurring scheduler's next-fire instances. For providers on a cron
 * cadence (every 6h for GitLab/GitHub, etc.) the next-fire is ALWAYS
 * sitting in `delayed`, so a naive scan blocks every Sync-now click
 * between cron ticks. We filter those out by checking for the BullMQ
 * repeat marker — `opts.repeat` is set on the recurring-schedule's
 * placeholder job and on each next-fire it spawns. A retry-backoff job
 * does NOT carry that marker, so it still dedupes correctly.
 */
async function hasInFlightJob(
  queueName: string,
  sourceId: string,
): Promise<boolean> {
  const q = getQueue(queueName);
  const jobs = await q.getJobs(['waiting', 'active', 'delayed'], 0, 200, false);
  for (const job of jobs) {
    const data = job.data as { sourceId?: string } | null;
    if (data?.sourceId !== sourceId) continue;
    if (job.opts?.repeat) continue;
    return true;
  }
  return false;
}

export async function enqueueResync(
  provider: Provider,
  payload: { sourceId: string; organizationId: string },
): Promise<{ enqueued: string[]; deduped: string[] }> {
  const names = QUEUE_NAMES_BY_PROVIDER[provider];
  const enqueued: string[] = [];
  const deduped: string[] = [];
  for (const name of names) {
    if (await hasInFlightJob(name, payload.sourceId)) {
      // Another job for this source is already running or queued —
      // folding repeat-clicks into the existing run keeps the worker
      // pool sane and avoids the duplicate "googledrive-sync" rows the
      // user noticed in sync history. The picker's "Save & continue"
      // and Sync now buttons remain idempotent from the user's POV: any
      // changes saved to the allowlist before the in-flight job's next
      // page-list query will be picked up automatically.
      deduped.push(name);
      continue;
    }
    await getQueue(name).add('sync', payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    enqueued.push(name);
  }
  return { enqueued, deduped };
}

/**
 * Enqueue a one-shot sync for every source the org has registered for the
 * given provider. Use after a successful OAuth/api-key connect so the user
 * doesn't have to wait for the next 6h scheduler tick.
 */
export async function enqueueInitialSync(
  db: DB,
  organizationId: string,
  provider: Provider,
): Promise<{ enqueuedSources: number }> {
  const sourceRows = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, organizationId),
        eq(schema.sources.provider, provider),
      ),
    );
  for (const s of sourceRows) {
    await enqueueResync(provider, { sourceId: s.id, organizationId });
  }
  return { enqueuedSources: sourceRows.length };
}

export function activeQueueNames(provider: Provider): string[] {
  return [...QUEUE_NAMES_BY_PROVIDER[provider]];
}

export function getQueueByName(name: string): Queue {
  return getQueue(name);
}

/**
 * Drain all queued/delayed/failed jobs for a provider scoped to one org.
 * Called from the disconnect handler so stale jobs don't fight the new
 * install with a now-revoked token (Slack returns `account_inactive` in
 * that race). Active jobs aren't forcibly killed — they finish on their
 * own and may log one error; new jobs after that are gone.
 *
 * Returns counts per state for logging. Best-effort: a Redis hiccup
 * shouldn't block the disconnect response.
 */
/**
 * Enqueue an async cleanup job for a connector that has just been disconnected.
 * The DELETE route calls this after running the bounded fast bits inline; the
 * worker handles the slow `db.delete(sources)` cascade off-thread so the
 * request returns immediately.
 */
export async function enqueueDisconnectCleanup(
  payload: DisconnectCleanupJobPayload,
): Promise<void> {
  await getQueue(DISCONNECT_CLEANUP_QUEUE).add('cleanup', payload, {
    removeOnComplete: 100,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

export async function drainJobsForOrg(
  provider: Provider,
  organizationId: string,
): Promise<{ removed: Record<string, number> }> {
  const removed: Record<string, number> = {};
  for (const name of QUEUE_NAMES_BY_PROVIDER[provider]) {
    const queue = getQueue(name);
    let count = 0;
    // 'active' jobs are mid-flight — leave them alone (forcing them off
    // breaks the worker's connection guarantees). 'completed' is keepable
    // history. We remove waiting / delayed / failed for this org.
    const jobs = await queue.getJobs(['waiting', 'delayed', 'failed', 'paused']);
    for (const j of jobs) {
      const payload = j.data as { organizationId?: string } | undefined;
      if (payload?.organizationId !== organizationId) continue;
      try {
        await j.remove();
        count += 1;
      } catch {
        // Race with another worker picking the job up — ignore.
      }
    }
    removed[name] = count;
  }
  return { removed };
}
