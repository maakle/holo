import { describe, expect, it } from 'vitest';
import { PLAN_DEFAULT_STORAGE_CAP, resolveStorageCap } from '../src/plan-defaults';

describe('resolveStorageCap', () => {
  it('returns the row value when set (honours explicit numbers)', () => {
    expect(resolveStorageCap('free', 25_000)).toBe(25_000);
    expect(resolveStorageCap('team', 5_000_000)).toBe(5_000_000);
  });

  it('honours explicit null on the row (intentional unlimited)', () => {
    expect(resolveStorageCap('team', null)).toBe(null);
    expect(resolveStorageCap('enterprise', null)).toBe(null);
  });

  it('falls back to the slug default when the row value is undefined', () => {
    // The common case: legacy `billing_plans` row from before migration 0067
    // where the JSONB key is simply missing.
    expect(resolveStorageCap('free', undefined)).toBe(25_000);
    expect(resolveStorageCap('starter', undefined)).toBe(100_000);
    expect(resolveStorageCap('team', undefined)).toBe(500_000);
    expect(resolveStorageCap('scale', undefined)).toBe(2_000_000);
    expect(resolveStorageCap('business', undefined)).toBe(10_000_000);
  });

  it('returns null (unlimited) for unknown slugs', () => {
    // Custom/legacy slugs we don't have an opinion on get the safe default
    // of no cap rather than an arbitrary number.
    expect(resolveStorageCap('starter-legacy-2026-05', undefined)).toBe(null);
    expect(resolveStorageCap('foo', undefined)).toBe(null);
  });

  it('exposes enterprise as null in the constants map', () => {
    expect(PLAN_DEFAULT_STORAGE_CAP.enterprise).toBe(null);
  });
});
