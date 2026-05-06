import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../src/redact.js';

describe('redactSensitive', () => {
  it('redacts sensitive object keys regardless of casing', () => {
    expect(
      redactSensitive({
        Authorization: 'Bearer abc123abc123abc123',
        cookie: 'session=xyz',
        password: 'hunter2',
        api_key: 'k_123',
        ApiKey: 'k_456',
        clientSecret: 'shh',
        nested: { refresh_token: 'r' },
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      password: '[REDACTED]',
      api_key: '[REDACTED]',
      ApiKey: '[REDACTED]',
      clientSecret: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]' },
    });
  });

  it('redacts secret-shaped values found anywhere in a string', () => {
    expect(redactSensitive('Authorization: Bearer abcdef0123456789')).toBe(
      '[REDACTED]',
    );
    expect(redactSensitive('sk-abc123abc123abc123')).toBe('[REDACTED]');
    expect(redactSensitive('xoxb-1234567890-abcdef')).toBe('[REDACTED]');
    expect(redactSensitive('ghp_abcdef0123456789ABCD')).toBe('[REDACTED]');
    expect(redactSensitive('AKIAABCDEFGHIJKLMNOP')).toBe('[REDACTED]');
  });

  it('passes through ordinary values unchanged', () => {
    const v = { question: 'what is up?', count: 42, ok: true, list: [1, 2, 3] };
    expect(redactSensitive(v)).toEqual(v);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it('preserves arrays as arrays', () => {
    const out = redactSensitive([{ token: 'x' }, { ok: true }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([{ token: '[REDACTED]' }, { ok: true }]);
  });

  it('caps recursion depth without throwing', () => {
    type Recursive = { next?: Recursive; api_key?: string };
    let head: Recursive = { api_key: 'leaf-secret' };
    for (let i = 0; i < 50; i++) head = { next: head };
    expect(() => redactSensitive(head)).not.toThrow();
  });
});
