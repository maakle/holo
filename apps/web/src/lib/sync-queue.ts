import 'server-only';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

type Provider = 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear';

const QUEUE_NAMES_BY_PROVIDER: Record<Provider, string[]> = {
  github: ['github-code-sync', 'github-prose-sync'],
  slack: ['slack-sync'],
  notion: ['notion-sync'],
  grain: ['grain-sync'],
  pylon: ['pylon-sync'],
  hubspot: ['hubspot-sync'],
  linear: ['linear-sync'],
};

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

export async function enqueueResync(
  provider: Provider,
  payload: { sourceId: string; organizationId: string },
): Promise<{ enqueued: string[] }> {
  const names = QUEUE_NAMES_BY_PROVIDER[provider];
  const enqueued: string[] = [];
  for (const name of names) {
    await getQueue(name).add('sync', payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    enqueued.push(name);
  }
  return { enqueued };
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
