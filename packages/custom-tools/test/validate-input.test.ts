import { describe, it, expect } from 'vitest';
import { validateInput } from '../src/validate-input.js';

const schema = {
  type: 'object',
  properties: {
    sql: { type: 'string', minLength: 1 },
  },
  required: ['sql'],
  additionalProperties: false,
} as const;

describe('validateInput', () => {
  it('returns parsed args when valid', () => {
    expect(validateInput(schema as unknown as Record<string, unknown>, { sql: 'SELECT 1' })).toEqual({ sql: 'SELECT 1' });
  });

  it('throws structured error on missing required prop', () => {
    expect(() => validateInput(schema as unknown as Record<string, unknown>, {})).toThrow(/sql/);
  });

  it('throws on additional properties (strict)', () => {
    expect(() => validateInput(schema as unknown as Record<string, unknown>, { sql: 'x', extra: 1 })).toThrow();
  });

  it('throws on type mismatch', () => {
    expect(() => validateInput(schema as unknown as Record<string, unknown>, { sql: 42 })).toThrow();
  });

  it('rejects non-object inputs', () => {
    expect(() => validateInput(schema as unknown as Record<string, unknown>, null)).toThrow();
    expect(() => validateInput(schema as unknown as Record<string, unknown>, 'string')).toThrow();
  });
});
