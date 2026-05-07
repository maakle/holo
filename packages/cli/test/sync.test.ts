import { describe, it, expect, vi } from 'vitest';
import { runSync, isSyncProvider, SYNC_PROVIDERS } from '../src/commands/sync-run.js';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

// Builds a fake drizzle DB whose `select(...).from(sources).where(...)` chain
// resolves to the rows we hand it. The real CLI only uses this one shape, so
// we don't need a full drizzle stub.
function fakeDbWithSources(rows: Array<{ id: string; name: string }>): DB {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select } as unknown as DB;
}

describe('isSyncProvider', () => {
  it('accepts every provider in the published set', () => {
    for (const p of SYNC_PROVIDERS) {
      expect(isSyncProvider(p)).toBe(true);
    }
  });

  it('rejects unknowns', () => {
    expect(isSyncProvider('linear')).toBe(false);
    expect(isSyncProvider('')).toBe(false);
  });
});

describe('runSync', () => {
  it('rejects an unknown provider with HOLO_INVALID_INPUT', async () => {
    await expect(
      runSync({
        db: fakeDbWithSources([]),
        organizationId: 'org-1',
        provider: 'twitter',
        redisUrl: 'redis://unused',
        enqueue: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });

  it('throws HOLO_NOT_FOUND when the org has no sources for the provider', async () => {
    await expect(
      runSync({
        db: fakeDbWithSources([]),
        organizationId: 'org-1',
        provider: 'slack',
        redisUrl: 'redis://unused',
        enqueue: async () => {},
      }),
    ).rejects.toMatchObject({ code: 'HOLO_NOT_FOUND' });
  });

  it('enqueues one job per (source × queue) for slack (1 queue)', async () => {
    const calls: Array<{ queueName: string; sourceId: string }> = [];
    const out = await runSync({
      db: fakeDbWithSources([
        { id: 'src-A', name: 'workspace A' },
        { id: 'src-B', name: 'workspace B' },
      ]),
      organizationId: 'org-1',
      provider: 'slack',
      redisUrl: 'redis://unused',
      enqueue: async ({ queueName, payload }) => {
        calls.push({ queueName, sourceId: payload.sourceId });
      },
    });
    expect(out.queueNames).toEqual(['slack-sync']);
    expect(out.jobsEnqueued).toBe(2);
    expect(calls).toEqual([
      { queueName: 'slack-sync', sourceId: 'src-A' },
      { queueName: 'slack-sync', sourceId: 'src-B' },
    ]);
  });

  it('fans github sources out across both code and prose queues', async () => {
    const calls: string[] = [];
    const out = await runSync({
      db: fakeDbWithSources([{ id: 'src-1', name: 'monorepo' }]),
      organizationId: 'org-1',
      provider: 'github',
      redisUrl: 'redis://unused',
      enqueue: async ({ queueName }) => {
        calls.push(queueName);
      },
    });
    expect(out.queueNames).toEqual(['github-code-sync', 'github-prose-sync']);
    expect(out.jobsEnqueued).toBe(2);
    expect(calls).toEqual(['github-code-sync', 'github-prose-sync']);
  });

  it('only selects sources for the requested org and provider', async () => {
    const where = vi.fn().mockResolvedValue([{ id: 'src-1', name: 's' }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as DB;

    await runSync({
      db,
      organizationId: 'org-XYZ',
      provider: 'notion',
      redisUrl: 'redis://unused',
      enqueue: async () => {},
    });

    // First positional arg of select() is the projection. We just want to
    // confirm we asked for sources by primary key + name.
    expect(select).toHaveBeenCalledWith({
      id: schema.sources.id,
      name: schema.sources.name,
    });
    expect(from).toHaveBeenCalledWith(schema.sources);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
