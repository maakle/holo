import { describe, it, expect } from 'vitest';
import {
  step,
  createInMemoryCheckpointStore,
  type CheckpointStore,
} from '../src/step';

describe('step() checkpoint helper', () => {
  it('runs the inner function on first invocation and persists the result', async () => {
    const store = createInMemoryCheckpointStore();
    let calls = 0;
    const out = await step({
      store,
      sourceId: 's1',
      jobId: 'job-A',
      name: 'fetch',
      run: async () => {
        calls += 1;
        return { fetched: 42 };
      },
    });
    expect(calls).toBe(1);
    expect(out).toEqual({ fetched: 42 });
    const dumped = store.dump();
    expect(dumped['s1']!['job-A']!['fetch']!.result).toEqual({ fetched: 42 });
    expect(typeof dumped['s1']!['job-A']!['fetch']!.completedAt).toBe('string');
  });

  it('returns the cached result on re-run and does not re-execute', async () => {
    const store = createInMemoryCheckpointStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return { value: calls };
    };
    const first = await step({ store, sourceId: 's1', jobId: 'job-A', name: 'fetch', run });
    const second = await step({ store, sourceId: 's1', jobId: 'job-A', name: 'fetch', run });
    expect(first).toEqual({ value: 1 });
    expect(second).toEqual({ value: 1 }); // cached, not re-executed
    expect(calls).toBe(1);
  });

  it('idempotency on resume: kills after step 2, restart skips step 1+2 and runs step 3', async () => {
    const store = createInMemoryCheckpointStore();
    const calls: Record<string, number> = { one: 0, two: 0, three: 0 };

    const runJob = async (opts: { killAfter?: 'one' | 'two' | 'three' }) => {
      const r1 = await step({
        store,
        sourceId: 's1',
        jobId: 'job-X',
        name: 'one',
        run: async () => {
          calls.one += 1;
          return 'r1';
        },
      });
      if (opts.killAfter === 'one') return { r1 };

      const r2 = await step({
        store,
        sourceId: 's1',
        jobId: 'job-X',
        name: 'two',
        run: async () => {
          calls.two += 1;
          return 'r2';
        },
      });
      if (opts.killAfter === 'two') return { r1, r2 };

      const r3 = await step({
        store,
        sourceId: 's1',
        jobId: 'job-X',
        name: 'three',
        run: async () => {
          calls.three += 1;
          return 'r3';
        },
      });
      return { r1, r2, r3 };
    };

    // First attempt: dies after step 2
    const partial = await runJob({ killAfter: 'two' });
    expect(partial).toEqual({ r1: 'r1', r2: 'r2' });
    expect(calls).toEqual({ one: 1, two: 1, three: 0 });

    // Restart: full run. Step 1+2 must be skipped (cached), step 3 runs once.
    const full = await runJob({});
    expect(full).toEqual({ r1: 'r1', r2: 'r2', r3: 'r3' });
    expect(calls).toEqual({ one: 1, two: 1, three: 1 });
  });

  it('checkpoints are scoped per-jobId so concurrent jobs do not collide', async () => {
    const store = createInMemoryCheckpointStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return calls;
    };
    const a = await step({ store, sourceId: 's1', jobId: 'job-A', name: 'fetch', run });
    const b = await step({ store, sourceId: 's1', jobId: 'job-B', name: 'fetch', run });
    expect(a).toBe(1);
    expect(b).toBe(2); // different jobId → re-runs
    expect(calls).toBe(2);
  });

  it('falsy results (0, "", false) are still cached and not re-executed', async () => {
    const store = createInMemoryCheckpointStore();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return 0;
    };
    const a = await step({ store, sourceId: 's1', jobId: 'job-Z', name: 'count', run });
    const b = await step({ store, sourceId: 's1', jobId: 'job-Z', name: 'count', run });
    expect(a).toBe(0);
    expect(b).toBe(0);
    expect(calls).toBe(1);
  });
});

describe('CheckpointStore contract', () => {
  it('read returns null for unknown keys', async () => {
    const store: CheckpointStore = createInMemoryCheckpointStore();
    expect(await store.read('s', 'j', 'n')).toBeNull();
  });
});
