import { describe, it, expect, beforeEach } from 'vitest';
import { processHeartbeat, _resetHeartbeatCounter } from '../src/jobs/heartbeat';

describe('processHeartbeat', () => {
  beforeEach(() => _resetHeartbeatCounter());

  it('increments counter on each invocation', async () => {
    const r1 = await processHeartbeat();
    const r2 = await processHeartbeat();
    expect(r1.counter).toBe(1);
    expect(r2.counter).toBe(2);
    expect(typeof r1.ts).toBe('string');
    expect(new Date(r1.ts).toString()).not.toBe('Invalid Date');
  });
});
