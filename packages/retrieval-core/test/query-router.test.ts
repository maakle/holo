import { describe, it, expect } from 'vitest';
import { looksLikeCode } from '../src/query-router';

describe('looksLikeCode', () => {
  it('matches code keywords', () => {
    expect(looksLikeCode('function getUser(id) { return db.find(id); }')).toBe(true);
    expect(looksLikeCode('class Foo')).toBe(true);
    expect(looksLikeCode('def bar():')).toBe(true);
    expect(looksLikeCode('import x from "y"')).toBe(true);
    expect(looksLikeCode('interface User')).toBe(true);
  });

  it('matches code-like punctuation patterns', () => {
    expect(looksLikeCode('foo(bar, baz);')).toBe(true);
    expect(looksLikeCode('x = a + b')).toBe(true);
  });

  it('treats prose questions as non-code', () => {
    expect(looksLikeCode('how do I reset my password?')).toBe(false);
    expect(looksLikeCode('what is MFA retention')).toBe(false);
    expect(looksLikeCode('tell me about UKG Pro integration')).toBe(false);
  });
});
