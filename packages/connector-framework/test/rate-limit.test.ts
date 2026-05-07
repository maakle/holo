import { describe, it, expect } from 'vitest';
import { TokenBucket } from '../src/http/rate-limit';

describe('TokenBucket', () => {
  it('allows immediate consumption up to burst', async () => {
    let now = 1000;
    const bucket = new TokenBucket({ rps: 1, burst: 3 }, () => now);
    await bucket.take();
    await bucket.take();
    await bucket.take();
    // 4th take should still resolve, but only after 1s of refill at rps=1.
    let resolved = false;
    const p = bucket.take().then(() => {
      resolved = true;
    });
    // drain timer is real setTimeout — we need to advance fake clock and
    // give the event loop a chance to run the callback.
    now += 1100;
    await new Promise((r) => setTimeout(r, 1200));
    await p;
    expect(resolved).toBe(true);
  });

  it('aborts a pending take when signal fires', async () => {
    const bucket = new TokenBucket({ rps: 0.001, burst: 0 });
    const ctrl = new AbortController();
    const p = bucket.take(ctrl.signal);
    ctrl.abort(new Error('stop'));
    await expect(p).rejects.toThrow();
  });

  it('refills proportionally to elapsed time', async () => {
    let now = 0;
    const bucket = new TokenBucket({ rps: 10, burst: 10 }, () => now);
    // Drain the bucket.
    for (let i = 0; i < 10; i += 1) await bucket.take();
    // Advance clock by 500ms = 5 tokens.
    now = 500;
    await bucket.take();
    await bucket.take();
    await bucket.take();
    await bucket.take();
    await bucket.take();
    // 6th take should block.
    let blocked = true;
    const p = bucket.take().then(() => {
      blocked = false;
    });
    // Don't await; just confirm it didn't immediately resolve at this clock.
    await new Promise((r) => setImmediate(r));
    expect(blocked).toBe(true);
    // Advance clock to allow drain, then await.
    now = 2000;
    await new Promise((r) => setTimeout(r, 1500));
    await p;
  });
});
