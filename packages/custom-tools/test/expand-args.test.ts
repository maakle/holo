import { describe, it, expect } from 'vitest';
import { expandArgs } from '../src/expand-args.js';

describe('expandArgs', () => {
  it('substitutes a single placeholder', () => {
    expect(expandArgs(['query', '{{sql}}'], { sql: 'SELECT 1' }))
      .toEqual(['query', 'SELECT 1']);
  });

  it('substitutes multiple placeholders, preserving order', () => {
    expect(
      expandArgs(['--from', '{{a}}', '--to', '{{b}}'], { a: 'x', b: 'y' }),
    ).toEqual(['--from', 'x', '--to', 'y']);
  });

  it('preserves literal {{ via {{{{ escape', () => {
    expect(expandArgs(['echo', '{{{{literal}}}}'], {})).toEqual(['echo', '{{literal}}']);
  });

  it('throws on missing placeholder value', () => {
    expect(() => expandArgs(['{{missing}}'], {})).toThrow(/missing/i);
  });

  it('passes shell metacharacters through as literal argv', () => {
    expect(expandArgs(['{{x}}'], { x: '$(rm -rf /); echo hi' }))
      .toEqual(['$(rm -rf /); echo hi']);
  });

  it('stringifies non-string values (numbers, booleans)', () => {
    expect(expandArgs(['{{n}}', '{{b}}'], { n: 42, b: true }))
      .toEqual(['42', 'true']);
  });

  it('rejects nested or partial placeholders cleanly', () => {
    // A bare `{{` with no closing `}}` is invalid.
    expect(() => expandArgs(['{{unclosed'], { unclosed: 'x' })).toThrow();
  });
});
