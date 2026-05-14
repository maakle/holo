import { describe, it, expect } from 'vitest';
import { intParam } from '../src/sql-helpers';

// We assert on the SQL shape via drizzle's queryChunks: the array alternates
// between StringChunk and Param. Future "optimisations" that drop the
// explicit `::integer` cast must fail this test loudly.
function serializeChunks(sqlObj: unknown): string {
  const chunks = (sqlObj as { queryChunks: unknown[] }).queryChunks;
  return chunks
    .map((c) => {
      if (c && typeof c === 'object') {
        if ('value' in c && Array.isArray((c as { value: unknown }).value)) {
          // StringChunk stores its segments as a string[].
          return ((c as { value: string[] }).value).join('');
        }
        if ('value' in c) {
          // Param.
          return `<${String((c as { value: unknown }).value)}>`;
        }
      }
      return String(c);
    })
    .join('');
}

describe('intParam', () => {
  it('binds the value and appends an ::integer cast', () => {
    expect(serializeChunks(intParam(42))).toBe('42::integer');
    expect(serializeChunks(intParam(0))).toBe('0::integer');
    expect(serializeChunks(intParam(-7))).toBe('-7::integer');
  });

  it('throws on non-integer values so callers fail loudly', () => {
    expect(() => intParam(1.5)).toThrow(/integer/);
    expect(() => intParam(Number.NaN)).toThrow(/integer/);
    expect(() => intParam(Number.POSITIVE_INFINITY)).toThrow(/integer/);
  });

  it('accepts zero and negative integers', () => {
    expect(() => intParam(0)).not.toThrow();
    expect(() => intParam(-1)).not.toThrow();
  });
});
