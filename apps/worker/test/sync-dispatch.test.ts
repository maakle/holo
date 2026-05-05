import { describe, it, expect, vi } from 'vitest';
import {
  decideSyncMode,
  runSyncJob,
  type SyncRunner,
} from '../src/queues/sync-dispatch';
import { createInMemorySyncCursorStore } from '../src/queues/sync-cursor-store';
import { createInMemoryCheckpointStore } from '../src/step';
import type { SyncCursor, SyncJobPayload } from '../src/queues/types';

const payload: SyncJobPayload = { sourceId: 'src-1', organizationId: 'org-1' };

describe('decideSyncMode', () => {
  const empty: SyncCursor = { exists: false, metadata: {}, latestSeenTs: null };
  const present: SyncCursor = { exists: true, metadata: {}, latestSeenTs: new Date() };

  it('returns "full" when cursor absent on slack/notion/github-prose queues', () => {
    expect(decideSyncMode({ queue: 'slack-sync', cursor: empty })).toBe('full');
    expect(decideSyncMode({ queue: 'notion-sync', cursor: empty })).toBe('full');
    expect(decideSyncMode({ queue: 'github-prose-sync', cursor: empty })).toBe('full');
  });

  it('returns "incremental" when cursor present on slack/notion/github-prose queues', () => {
    expect(decideSyncMode({ queue: 'slack-sync', cursor: present })).toBe('incremental');
    expect(decideSyncMode({ queue: 'notion-sync', cursor: present })).toBe('incremental');
    expect(decideSyncMode({ queue: 'github-prose-sync', cursor: present })).toBe('incremental');
  });

  it('github-code-sync: branches on metadata.last_indexed_sha — null/missing → code-initial', () => {
    expect(decideSyncMode({ queue: 'github-code-sync', cursor: empty })).toBe('code-initial');
    expect(
      decideSyncMode({
        queue: 'github-code-sync',
        cursor: { exists: true, metadata: {}, latestSeenTs: null },
      }),
    ).toBe('code-initial');
    expect(
      decideSyncMode({
        queue: 'github-code-sync',
        cursor: { exists: true, metadata: { last_indexed_sha: '' }, latestSeenTs: null },
      }),
    ).toBe('code-initial');
  });

  it('github-code-sync: non-empty last_indexed_sha → code-incremental', () => {
    expect(
      decideSyncMode({
        queue: 'github-code-sync',
        cursor: { exists: true, metadata: { last_indexed_sha: 'abc123' }, latestSeenTs: null },
      }),
    ).toBe('code-incremental');
  });
});

describe('runSyncJob', () => {
  function makeStores() {
    return {
      cursorStore: createInMemorySyncCursorStore(),
      checkpointStore: createInMemoryCheckpointStore(),
    };
  }

  it('first run with absent cursor: invokes runner.full exactly once and writes the cursor', async () => {
    const stores = makeStores();
    const full = vi.fn(async () => ({
      artifactCount: 5,
      newCursor: new Date('2026-04-30T00:00:00Z'),
    }));
    const runner: SyncRunner = { full };

    const result = await runSyncJob({
      queue: 'slack-sync',
      jobId: 'job-1',
      payload,
      runner,
      ...stores,
    });

    expect(full).toHaveBeenCalledTimes(1);
    expect(full).toHaveBeenCalledWith(payload, expect.any(Object));
    expect(result.artifactCount).toBe(5);
    const cursor = await stores.cursorStore.read('src-1');
    expect(cursor.exists).toBe(true);
    expect(cursor.latestSeenTs?.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('second run with present cursor: invokes runner.incremental, not full', async () => {
    const stores = makeStores();
    await stores.cursorStore.upsertAfterSync('src-1', {
      latestSeenTs: new Date('2026-04-29T00:00:00Z'),
      status: 'ok',
    });
    const full = vi.fn();
    const incremental = vi.fn(async () => ({ artifactCount: 2, newCursor: new Date() }));
    const runner: SyncRunner = { full, incremental };

    await runSyncJob({
      queue: 'slack-sync',
      jobId: 'job-2',
      payload,
      runner,
      ...stores,
    });

    expect(full).not.toHaveBeenCalled();
    expect(incremental).toHaveBeenCalledTimes(1);
  });

  it('github-code-sync: routes by last_indexed_sha to codeInitial vs codeIncremental', async () => {
    const stores = makeStores();
    const codeInitial = vi.fn(async () => ({
      artifactCount: 100,
      newCursor: null,
      metadataPatch: { last_indexed_sha: 'sha-after-initial' },
    }));
    const codeIncremental = vi.fn(async () => ({ artifactCount: 3, newCursor: null }));
    const runner: SyncRunner = { codeInitial, codeIncremental };

    await runSyncJob({
      queue: 'github-code-sync',
      jobId: 'job-A',
      payload,
      runner,
      ...stores,
    });
    expect(codeInitial).toHaveBeenCalledTimes(1);
    expect(codeIncremental).not.toHaveBeenCalled();

    // After the first run the metadataPatch sets last_indexed_sha; the next
    // run should branch to code-incremental.
    await runSyncJob({
      queue: 'github-code-sync',
      jobId: 'job-B',
      payload,
      runner,
      ...stores,
    });
    expect(codeInitial).toHaveBeenCalledTimes(1);
    expect(codeIncremental).toHaveBeenCalledTimes(1);
  });

  it('checkpoint resume: re-running same jobId after a partial completion does not re-invoke runner', async () => {
    const stores = makeStores();
    const full = vi.fn(async () => ({ artifactCount: 7, newCursor: null }));
    const runner: SyncRunner = { full };

    await runSyncJob({
      queue: 'notion-sync',
      jobId: 'job-resume',
      payload,
      runner,
      ...stores,
    });
    // Re-run with the SAME jobId — the step() helper caches, so runner is not
    // called again. (BullMQ retries reuse the job id.)
    await runSyncJob({
      queue: 'notion-sync',
      jobId: 'job-resume',
      payload,
      runner,
      ...stores,
    });
    expect(full).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when the runner does not implement the chosen mode', async () => {
    const stores = makeStores();
    const runner: SyncRunner = {}; // intentionally empty
    await expect(
      runSyncJob({
        queue: 'slack-sync',
        jobId: 'job-err',
        payload,
        runner,
        ...stores,
      }),
    ).rejects.toThrow(/SyncRunner\.full not implemented/);
  });
});
