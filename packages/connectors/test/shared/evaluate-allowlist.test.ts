import { describe, it, expect } from 'vitest';
import { evaluateAllowlist } from '../../src/shared/allowlist';

/**
 * Pure-function coverage for the allowlist matcher — the v0.1 test plan
 * (TODOS.md item #1) flags allowlist enforcement as CRITICAL because silent
 * drift would leak data into agent responses. The DB-backed `resolveAllowlist`
 * has integration tests in `allowlist.test.ts`; this file covers the
 * `evaluateAllowlist` pure function directly so the enforcement matrix runs
 * in CI without a live Postgres.
 *
 * Invariants we never want to drift:
 *  - empty include list → throw HOLO_ALLOWLIST_EMPTY (don't fall through to
 *    "everything matches", which would dump the whole org's source content)
 *  - exclude rows always win over include rows (deny-list semantics)
 *  - exact_id never matches by glob, glob never matches by exact-id literal
 *  - >50 resolved entries → throw HOLO_ALLOWLIST_OVERSIZED (cost guardrail)
 */

const PROVIDER = 'github';
const ORG = 'org-test';

describe('evaluateAllowlist (pure)', () => {
  describe('include semantics', () => {
    it('matches glob include patterns', () => {
      const r = evaluateAllowlist(
        [{ pattern: 'acme/*', patternKind: 'glob', decision: 'include' }],
        { provider: PROVIDER, organizationId: ORG, candidates: ['acme/widgets', 'acme/docs', 'other/repo'] },
      );
      expect(r.resolved).toEqual(['acme/widgets', 'acme/docs']);
      expect(r.matches('acme/widgets')).toBe(true);
      expect(r.matches('other/repo')).toBe(false);
    });

    it('matches exact_id only on equality, not by glob expansion', () => {
      const r = evaluateAllowlist(
        [{ pattern: 'acme/*', patternKind: 'exact_id', decision: 'include' }],
        { provider: PROVIDER, organizationId: ORG, candidates: ['acme/widgets', 'acme/*'] },
      );
      // 'acme/*' as exact_id matches the literal string 'acme/*', NOT the
      // glob expansion. acme/widgets must not leak through.
      expect(r.matches('acme/widgets')).toBe(false);
      expect(r.matches('acme/*')).toBe(true);
    });

    it('throws HOLO_ALLOWLIST_EMPTY when no include rows exist', () => {
      // The dangerous regression: empty allowlist must NOT fall through to
      // "everything is allowed". Verify the error code so a refactor that
      // reorders this branch can't ship silently.
      expect(() =>
        evaluateAllowlist(
          [{ pattern: 'archived', patternKind: 'glob', decision: 'exclude' }],
          { provider: PROVIDER, organizationId: ORG },
        ),
      ).toThrow(/HOLO_ALLOWLIST_EMPTY/);
    });

    it('throws HOLO_ALLOWLIST_EMPTY when rows array is empty', () => {
      expect(() =>
        evaluateAllowlist([], { provider: PROVIDER, organizationId: ORG }),
      ).toThrow(/HOLO_ALLOWLIST_EMPTY/);
    });
  });

  describe('exclude wins over include (deny-list semantics)', () => {
    it('include glob then exclude exact_id: the excluded id is dropped', () => {
      const r = evaluateAllowlist(
        [
          { pattern: 'acme/*', patternKind: 'glob', decision: 'include' },
          { pattern: 'acme/secret', patternKind: 'exact_id', decision: 'exclude' },
        ],
        {
          provider: PROVIDER,
          organizationId: ORG,
          candidates: ['acme/widgets', 'acme/secret', 'acme/docs'],
        },
      );
      expect(r.resolved).toEqual(['acme/widgets', 'acme/docs']);
      expect(r.matches('acme/secret')).toBe(false);
    });

    it('include glob then exclude glob: every match in exclude pattern is dropped', () => {
      const r = evaluateAllowlist(
        [
          { pattern: 'acme/*', patternKind: 'glob', decision: 'include' },
          { pattern: 'acme/internal-*', patternKind: 'glob', decision: 'exclude' },
        ],
        {
          provider: PROVIDER,
          organizationId: ORG,
          candidates: ['acme/widgets', 'acme/internal-billing', 'acme/internal-hr'],
        },
      );
      expect(r.resolved).toEqual(['acme/widgets']);
    });

    it('exclude with no overlapping include never widens the set', () => {
      // Defensive: an exclude pattern that doesn't intersect the include set
      // is a no-op. Must not be interpreted as "exclude only — include all".
      const r = evaluateAllowlist(
        [
          { pattern: 'acme/widgets', patternKind: 'exact_id', decision: 'include' },
          { pattern: 'unrelated/*', patternKind: 'glob', decision: 'exclude' },
        ],
        {
          provider: PROVIDER,
          organizationId: ORG,
          candidates: ['acme/widgets', 'unrelated/x', 'totally-other'],
        },
      );
      expect(r.resolved).toEqual(['acme/widgets']);
    });
  });

  describe('candidates vs. no-candidates resolution', () => {
    it('without candidates, resolves to the include patterns minus excluded ones', () => {
      const r = evaluateAllowlist(
        [
          { pattern: 'acme/widgets', patternKind: 'exact_id', decision: 'include' },
          { pattern: 'acme/docs', patternKind: 'exact_id', decision: 'include' },
        ],
        { provider: PROVIDER, organizationId: ORG },
      );
      expect(r.resolved.sort()).toEqual(['acme/docs', 'acme/widgets']);
      expect(r.include).toHaveLength(2);
      expect(r.exclude).toHaveLength(0);
    });
  });

  describe('cost guardrail', () => {
    it('throws HOLO_ALLOWLIST_OVERSIZED when resolved exceeds 50 entries', () => {
      const candidates = Array.from({ length: 51 }, (_, i) => `acme/repo-${i}`);
      expect(() =>
        evaluateAllowlist(
          [{ pattern: 'acme/*', patternKind: 'glob', decision: 'include' }],
          { provider: PROVIDER, organizationId: ORG, candidates },
        ),
      ).toThrow(/HOLO_ALLOWLIST_OVERSIZED/);
    });

    it('allows exactly 50 entries (boundary)', () => {
      const candidates = Array.from({ length: 50 }, (_, i) => `acme/repo-${i}`);
      const r = evaluateAllowlist(
        [{ pattern: 'acme/*', patternKind: 'glob', decision: 'include' }],
        { provider: PROVIDER, organizationId: ORG, candidates },
      );
      expect(r.resolved).toHaveLength(50);
    });
  });
});
