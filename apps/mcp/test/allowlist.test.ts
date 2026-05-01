import { describe, it, expect } from 'vitest';
import { checkToolAllowed } from '../src/middleware/allowlist.js';

describe('checkToolAllowed', () => {
  it('allows any tool when allowlist is empty', () => {
    expect(checkToolAllowed('search', [])).toBe(true);
  });

  it('allows tool present in allowlist', () => {
    expect(checkToolAllowed('search', ['search', 'get_pr'])).toBe(true);
  });

  it('blocks tool not in allowlist', () => {
    expect(checkToolAllowed('get_ticket', ['search', 'get_pr'])).toBe(false);
  });

  it('always allows execute_skill regardless of allowlist', () => {
    expect(checkToolAllowed('execute_skill', ['search'])).toBe(true);
  });

  it('always allows list_skills regardless of allowlist', () => {
    expect(checkToolAllowed('list_skills', ['search'])).toBe(true);
  });
});
