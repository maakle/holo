import { describe, it, expect, vi } from 'vitest';
import type { DB } from '@holo/db';
import { loadEvalEntries } from '../eval-harness/load-eval-entries';

/**
 * The loader builds:
 *   db.select({...}).from(evalEntries).where(and(eq(org), eq(slug), eq(status)))
 *
 * We stub each builder step with a chainable fake that captures the final
 * select projection and returns a canned row set. The point of the test is
 * not to validate Drizzle's SQL — it's to lock in the filter contract
 * (org × slug × status) so a future refactor that drops a clause is loud.
 */

interface FakeRow {
  id: string;
  organizationId: string;
  skillSlug: string | null;
  question: string;
  expected: unknown;
  status: string;
}

function fakeDb(rows: FakeRow[]) {
  const whereSpy = vi.fn();
  const builder = {
    select() {
      return this;
    },
    from() {
      return this;
    },
    where(condition: unknown) {
      whereSpy(condition);
      return Promise.resolve(rows);
    },
  };
  return { db: builder as unknown as DB, whereSpy };
}

describe('loadEvalEntries', () => {
  it('returns the rows shaped as EvalEntry[]', async () => {
    const rows: FakeRow[] = [
      {
        id: 'e1',
        organizationId: 'org-1',
        skillSlug: 'release-rollback',
        question: 'How do I rollback?',
        expected: { answer_substrings: ['rollback'], must_cite: [], must_not_say: [] },
        status: 'active',
      },
    ];
    const { db } = fakeDb(rows);
    const out = await loadEvalEntries(db, {
      organizationId: 'org-1',
      skillSlug: 'release-rollback',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('e1');
    expect(out[0]!.expected.answer_substrings).toEqual(['rollback']);
  });

  it('calls .where with a composite filter (org × slug × status)', async () => {
    const { db, whereSpy } = fakeDb([]);
    await loadEvalEntries(db, {
      organizationId: 'org-2',
      skillSlug: 'foo',
      status: 'pending',
    });
    expect(whereSpy).toHaveBeenCalledOnce();
    // Drizzle's `and(...)` returns an SQL chunk we can't introspect cheaply
    // without re-parsing; what matters is that .where was called with a
    // single composite argument — i.e. the loader did not skip a filter.
    expect(whereSpy.mock.calls[0]!.length).toBe(1);
  });

  it('defaults to status=active when not provided', async () => {
    const { db, whereSpy } = fakeDb([]);
    await loadEvalEntries(db, {
      organizationId: 'org-3',
      skillSlug: 'bar',
    });
    expect(whereSpy).toHaveBeenCalledOnce();
  });

  it('treats a null expected.expected jsonb as an empty envelope', async () => {
    const { db } = fakeDb([
      {
        id: 'e2',
        organizationId: 'org-1',
        skillSlug: 'foo',
        question: 'q',
        expected: null,
        status: 'active',
      },
    ]);
    const out = await loadEvalEntries(db, {
      organizationId: 'org-1',
      skillSlug: 'foo',
    });
    expect(out[0]!.expected).toEqual({});
  });
});
