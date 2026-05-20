import { describe, expect, it } from 'vitest';
import { deriveIdempotencyKey } from '../src/idempotency';

describe('deriveIdempotencyKey', () => {
  it('is deterministic for the same (kind, id) pair', () => {
    const a = deriveIdempotencyKey('sync_run', 'abc-123');
    const b = deriveIdempotencyKey('sync_run', 'abc-123');
    expect(a).toBe(b);
  });

  it('differs across kinds', () => {
    const a = deriveIdempotencyKey('sync_run', 'abc-123');
    const b = deriveIdempotencyKey('agent_loop', 'abc-123');
    expect(a).not.toBe(b);
  });

  it('differs across ids', () => {
    const a = deriveIdempotencyKey('sync_run', 'abc-123');
    const b = deriveIdempotencyKey('sync_run', 'abc-124');
    expect(a).not.toBe(b);
  });

  it('returns a 36-char UUID-shaped string', () => {
    const key = deriveIdempotencyKey('sync_run', 'abc-123');
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
