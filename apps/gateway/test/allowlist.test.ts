import { describe, it, expect, vi } from 'vitest';
import { checkToolAllowed, resolveActiveToolAllowlist } from '../src/middleware/allowlist.js';
import type { DB } from '@holo/db';

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

/**
 * Stub the chained Drizzle select pattern:
 *   db.select({...}).from(...).where(...).limit(1)
 * by returning the same chainable on every step until `limit`, which resolves
 * to the configured rows.
 */
function stubDb(rows: Array<{ toolAllowlist: string[] }>): DB {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };
  return { select: vi.fn(() => chain) } as unknown as DB;
}

describe('resolveActiveToolAllowlist', () => {
  it('returns [] when no header is set', async () => {
    const db = stubDb([{ toolAllowlist: ['search'] }]);
    const result = await resolveActiveToolAllowlist(db, 'org-1', undefined);
    expect(result).toEqual([]);
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });

  it('returns [] when the slug does not resolve to an active skill', async () => {
    const db = stubDb([]); // no rows
    const result = await resolveActiveToolAllowlist(db, 'org-1', 'unknown-slug');
    expect(result).toEqual([]);
  });

  it('returns the matched skill toolAllowlist when the slug resolves', async () => {
    const db = stubDb([{ toolAllowlist: ['search', 'get_pr'] }]);
    const result = await resolveActiveToolAllowlist(db, 'org-1', 'pr-security-review');
    expect(result).toEqual(['search', 'get_pr']);
  });

  it('returns [] when the matched skill has an empty allowlist (allow-all default)', async () => {
    const db = stubDb([{ toolAllowlist: [] }]);
    const result = await resolveActiveToolAllowlist(db, 'org-1', 'open-skill');
    expect(result).toEqual([]);
  });
});

describe('REST surface gate (parity with MCP transport)', () => {
  it("rejects search when the active skill's allowlist excludes 'search'", () => {
    // The REST router calls checkToolAllowed('search', allowlist) and throws
    // ALLOWLIST_EMPTY when it returns false. Test the predicate directly to
    // match the MCP transport's behavior.
    expect(checkToolAllowed('search', ['get_pr'])).toBe(false);
  });

  it("permits search when the active skill's allowlist explicitly includes 'search'", () => {
    expect(checkToolAllowed('search', ['search'])).toBe(true);
  });

  it('permits search when no skill is active (empty allowlist)', () => {
    expect(checkToolAllowed('search', [])).toBe(true);
  });

  it('always permits list_skills, get_skill, execute_skill regardless of active skill (skill-pivot exit hatches)', () => {
    expect(checkToolAllowed('list_skills', ['get_pr'])).toBe(true);
    expect(checkToolAllowed('get_skill', ['get_pr'])).toBe(true);
    expect(checkToolAllowed('execute_skill', ['get_pr'])).toBe(true);
  });
});
