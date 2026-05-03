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

  it('always allows get_skill regardless of allowlist', () => {
    expect(checkToolAllowed('get_skill', ['search'])).toBe(true);
  });
});

describe('checkToolAllowed (custom tools)', () => {
  const customs = new Set(['bigquery_analytics_query']);

  it('blocks custom tool when allowlist is empty (no auto-allow)', () => {
    expect(checkToolAllowed('bigquery_analytics_query', [], { customToolNames: customs })).toBe(false);
  });

  it('allows custom tool when listed in allowlist', () => {
    expect(
      checkToolAllowed('bigquery_analytics_query', ['bigquery_analytics_query'], { customToolNames: customs }),
    ).toBe(true);
  });

  it('still allows built-in with empty allowlist (regression)', () => {
    expect(checkToolAllowed('search', [], { customToolNames: customs })).toBe(true);
  });

  it('blocks unknown custom tool not in allowlist', () => {
    expect(checkToolAllowed('bigquery_analytics_query', ['search'], { customToolNames: customs })).toBe(false);
  });
});
