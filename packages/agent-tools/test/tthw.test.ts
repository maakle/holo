import { describe, it, expect, vi } from 'vitest';
import { readTthwEnv, maybeReportTthw } from '../src/tthw';
import type { DB } from '@holo/db';

// Minimal stub DB that simulates the "execute returns RETURNING rows" shape.
// Switch the inserted flag via .nextInserted() between calls.
function stubDb(): {
  db: DB;
  setNextInserted(v: boolean): void;
  setExecuteThrows(v: boolean): void;
  setUpdateStatus(v: 'sent' | 'failed'): void;
  calls: { type: 'insert' | 'update'; status?: string }[];
} {
  // The reporter calls db.execute exactly once for the INSERT, then exactly
  // once more for the post-POST UPDATE (if a POST was attempted). Sequence
  // the stub so the first execute is treated as the insert and the second
  // as the update — robust to whatever string form Drizzle's sql template
  // serializes to.
  let nextInserted = true;
  let executeThrows = false;
  let lastUpdateStatus: 'sent' | 'failed' = 'sent';
  let callCount = 0;
  const calls: { type: 'insert' | 'update'; status?: string }[] = [];
  const db = {
    execute: async () => {
      if (executeThrows) throw new Error('db down');
      callCount += 1;
      if (callCount === 1) {
        calls.push({ type: 'insert' });
        return nextInserted ? [{ install_id: 'fake' }] : [];
      }
      calls.push({ type: 'update', status: lastUpdateStatus });
      return [];
    },
  } as unknown as DB;
  return {
    db,
    setNextInserted: (v) => {
      nextInserted = v;
    },
    setExecuteThrows: (v) => {
      executeThrows = v;
    },
    setUpdateStatus: (v) => {
      lastUpdateStatus = v;
    },
    calls,
  };
}

describe('readTthwEnv', () => {
  it('parses populated env', () => {
    const env = readTthwEnv({
      HOLO_TELEMETRY_INSTALL_ID: 'abc',
      HOLO_TELEMETRY_STARTED_AT: '1700000000000',
      HOLO_TELEMETRY_OPT_IN: 'true',
      HOLO_TELEMETRY_ENDPOINT: 'https://t.example/r',
    });
    expect(env).toEqual({
      installId: 'abc',
      startedAtMs: 1700000000000,
      optedIn: true,
      endpoint: 'https://t.example/r',
    });
  });

  it('treats opt-in as false when not the literal "true"', () => {
    expect(readTthwEnv({ HOLO_TELEMETRY_OPT_IN: 'yes' }).optedIn).toBe(false);
    expect(readTthwEnv({ HOLO_TELEMETRY_OPT_IN: '1' }).optedIn).toBe(false);
    expect(readTthwEnv({}).optedIn).toBe(false);
  });

  it('drops a non-numeric started-at', () => {
    expect(readTthwEnv({ HOLO_TELEMETRY_STARTED_AT: 'soon' }).startedAtMs).toBeUndefined();
  });
});

describe('maybeReportTthw', () => {
  it('is a no-op when opt-in is false', async () => {
    const { db, calls } = stubDb();
    await maybeReportTthw({
      db,
      env: { installId: 'i1', startedAtMs: 1, optedIn: false, endpoint: 'https://t' },
    });
    expect(calls).toEqual([]);
  });

  it('is a no-op when install ID is missing', async () => {
    const { db, calls } = stubDb();
    await maybeReportTthw({
      db,
      env: { startedAtMs: 1, optedIn: true, endpoint: 'https://t' },
    });
    expect(calls).toEqual([]);
  });

  it('is a no-op when started-at is missing', async () => {
    const { db, calls } = stubDb();
    await maybeReportTthw({
      db,
      env: { installId: 'i1', optedIn: true, endpoint: 'https://t' },
    });
    expect(calls).toEqual([]);
  });

  it('inserts and POSTs when opt-in is true and endpoint is configured', async () => {
    const { db, calls } = stubDb();
    const onPost = vi.fn(async () => ({ ok: true }));
    await maybeReportTthw({
      db,
      env: {
        installId: 'i-ok',
        startedAtMs: 1_000,
        optedIn: true,
        endpoint: 'https://t.example/r',
      },
      now: () => 5_000,
      onPost,
    });
    // Wait one microtask tick so the fire-and-forget POST resolves before the assertion.
    await new Promise((r) => setImmediate(r));
    expect(onPost).toHaveBeenCalledWith({
      installId: 'i-ok',
      startedAtMs: 1_000,
      finishedAtMs: 5_000,
    });
    expect(calls.find((c) => c.type === 'update')?.status).toBe('sent');
  });

  it('records report_status=noop when no endpoint is configured', async () => {
    const { db, calls } = stubDb();
    const onPost = vi.fn();
    await maybeReportTthw({
      db,
      env: { installId: 'i-noop', startedAtMs: 1, optedIn: true },
      onPost,
    });
    expect(onPost).not.toHaveBeenCalled();
    expect(calls.length).toBe(1);
    expect(calls[0].type).toBe('insert');
  });

  it('records report_status=failed when the POST fails', async () => {
    const { db, calls, setUpdateStatus } = stubDb();
    setUpdateStatus('failed');
    const onPost = vi.fn(async () => ({ ok: false }));
    await maybeReportTthw({
      db,
      env: {
        installId: 'i-fail',
        startedAtMs: 1,
        optedIn: true,
        endpoint: 'https://t.example/r',
      },
      onPost,
    });
    await new Promise((r) => setImmediate(r));
    expect(calls.find((c) => c.type === 'update')?.status).toBe('failed');
  });

  it('skips the POST when the row was already inserted (already reported)', async () => {
    const { db, setNextInserted, calls } = stubDb();
    setNextInserted(false);
    const onPost = vi.fn();
    await maybeReportTthw({
      db,
      env: {
        installId: 'i-dup',
        startedAtMs: 1,
        optedIn: true,
        endpoint: 'https://t.example/r',
      },
      onPost,
    });
    expect(onPost).not.toHaveBeenCalled();
    expect(calls.find((c) => c.type === 'update')).toBeUndefined();
  });

  it('swallows DB errors so search is never blocked by telemetry', async () => {
    const { db, setExecuteThrows } = stubDb();
    setExecuteThrows(true);
    await expect(
      maybeReportTthw({
        db,
        env: {
          installId: 'i-err',
          startedAtMs: 1,
          optedIn: true,
          endpoint: 'https://t.example/r',
        },
      }),
    ).resolves.toBeUndefined();
  });
});
