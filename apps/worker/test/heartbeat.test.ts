import { describe, it, expect } from 'vitest';
import { HeartbeatProcessor } from '../src/heartbeat/heartbeat.processor';

describe('HeartbeatProcessor', () => {
  it('increments counter on each process call', async () => {
    const proc = new HeartbeatProcessor();
    const before = HeartbeatProcessor.counter;
    const r1 = await proc.process({} as never);
    const r2 = await proc.process({} as never);
    expect(r1.counter).toBe(before + 1);
    expect(r2.counter).toBe(before + 2);
    expect(typeof r1.ts).toBe('string');
  });
});
