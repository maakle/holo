import { describe, it, expect } from 'vitest';
import {
  exponentialBackoff,
  jitter,
  parseRetryAfter,
  resolveRetry,
} from '../src/http/retry';

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('parses HTTP-date relative to now()', () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThan(4_000);
    expect(ms!).toBeLessThan(6_000);
  });

  it('returns null on garbage', () => {
    expect(parseRetryAfter('not-a-thing')).toBeNull();
  });

  it('returns null when header is missing', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('clamps past dates to 0', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });
});

describe('exponentialBackoff', () => {
  it('doubles each attempt', () => {
    const cfg = { initialDelayMs: 100, maxDelayMs: 10_000 };
    expect(exponentialBackoff(1, cfg)).toBe(100);
    expect(exponentialBackoff(2, cfg)).toBe(200);
    expect(exponentialBackoff(3, cfg)).toBe(400);
    expect(exponentialBackoff(4, cfg)).toBe(800);
  });

  it('caps at maxDelayMs', () => {
    expect(exponentialBackoff(20, { initialDelayMs: 100, maxDelayMs: 1000 })).toBe(1000);
  });
});

describe('jitter', () => {
  it('stays within +/- 25% of base', () => {
    expect(jitter(100, () => 0)).toBe(75);
    expect(jitter(100, () => 1)).toBe(125);
    expect(jitter(100, () => 0.5)).toBe(100);
  });
});

describe('resolveRetry', () => {
  it('fills in defaults', () => {
    const r = resolveRetry();
    expect(r.maxAttempts).toBe(4);
    expect(r.retryOn).toEqual([429, 502, 503, 504]);
    expect(r.honorRetryAfter).toBe(true);
    expect(r.initialDelayMs).toBe(500);
  });

  it('respects overrides', () => {
    const r = resolveRetry({ maxAttempts: 7, retryOn: [500] });
    expect(r.maxAttempts).toBe(7);
    expect(r.retryOn).toEqual([500]);
  });
});
