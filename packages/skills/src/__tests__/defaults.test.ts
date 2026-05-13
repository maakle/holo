import { describe, it, expect } from 'vitest';
import { parseSkill } from '../format';
import { mergeSearchFilters } from '../defaults';

describe('parseSkill defaults', () => {
  it('parses a fully-specified defaults block', () => {
    const yaml = `---
name: pylon-only
description: search pylon
tools: [search]
defaults:
  accountFilter:
    tier: ['T0', 'T1']
    owner: ['support-team']
    accountId: ['acct_123']
  timeWindow:
    last: '14d'
  provider: ['pylon', 'grain']
---

Body.
`;
    const s = parseSkill(yaml);
    expect(s.frontmatter.defaults).toEqual({
      accountFilter: { tier: ['T0', 'T1'], owner: ['support-team'], accountId: ['acct_123'] },
      timeWindow: { last: '14d' },
      provider: ['pylon', 'grain'],
    });
  });

  it('omits defaults when absent', () => {
    const yaml = `---
name: no-defaults
description: nothing
tools: []
---
Body.
`;
    expect(parseSkill(yaml).frontmatter.defaults).toBeUndefined();
  });

  it('rejects non-string provider entry', () => {
    const yaml = `---
name: bad
description: bad
tools: []
defaults:
  provider: ['pylon', 42]
---
Body.
`;
    expect(() => parseSkill(yaml)).toThrow(/provider must be a string/);
  });

  it('rejects malformed timeWindow.last', () => {
    const yaml = `---
name: bad
description: bad
tools: []
defaults:
  timeWindow:
    last: 'fortnight'
---
Body.
`;
    expect(() => parseSkill(yaml)).toThrow(/duration/);
  });

  it('parses absolute timeWindow', () => {
    const yaml = `---
name: abs
description: abs
tools: []
defaults:
  timeWindow:
    from: '2026-01-01T00:00:00Z'
    to: '2026-12-31T23:59:59Z'
---
Body.
`;
    const s = parseSkill(yaml);
    expect(s.frontmatter.defaults?.timeWindow).toEqual({
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T23:59:59Z',
    });
  });

  it('rejects non-object defaults', () => {
    const yaml = `---
name: bad
description: bad
tools: []
defaults: 'not-an-object'
---
Body.
`;
    expect(() => parseSkill(yaml)).toThrow(/defaults" must be an object/);
  });
});

describe('mergeSearchFilters', () => {
  it('returns model filters when defaults are absent', () => {
    const merged = mergeSearchFilters({ provider: 'github' }, undefined);
    expect(merged.provider).toBe('github');
  });

  it('REJECTS a widening provider request in strict mode', () => {
    // The contract: skill with defaults.provider: ['pylon'] must reject
    // a model-requested provider: 'github'.
    expect(() =>
      mergeSearchFilters({ provider: 'github' }, { provider: ['pylon'] }),
    ).toThrow(/provider/);
  });

  it('allows narrowing to a subset of the default provider list', () => {
    const merged = mergeSearchFilters(
      { provider: 'pylon' },
      { provider: ['pylon', 'grain'] },
    );
    expect(merged.provider).toBe('pylon');
  });

  it('fills in defaults when model omits provider', () => {
    const merged = mergeSearchFilters({}, { provider: ['pylon', 'grain'] });
    expect(merged.provider).toEqual(['pylon', 'grain']);
  });

  it('rejects widening accountFilter.tier', () => {
    expect(() =>
      mergeSearchFilters(
        { accountFilter: { tier: ['T2'] } },
        { accountFilter: { tier: ['T0', 'T1'] } },
      ),
    ).toThrow(/tier/);
  });

  it('narrows timeWindow.last to the tighter window', () => {
    const merged = mergeSearchFilters(
      { timeWindow: { last: '7d' } },
      { timeWindow: { last: '14d' } },
    );
    expect(merged.timeWindow).toEqual({ last: '7d' });
  });

  it('rejects widening timeWindow.last', () => {
    expect(() =>
      mergeSearchFilters(
        { timeWindow: { last: '30d' } },
        { timeWindow: { last: '14d' } },
      ),
    ).toThrow(/timeWindow/);
  });

  it('non-strict mode silently narrows instead of throwing', () => {
    const merged = mergeSearchFilters(
      { provider: 'github' },
      { provider: ['pylon'] },
      { strict: false },
    );
    // github filtered out → empty intersection
    expect(merged.provider).toEqual([]);
  });
});
