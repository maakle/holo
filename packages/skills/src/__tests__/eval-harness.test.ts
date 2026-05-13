import { describe, it, expect } from 'vitest';
import {
  answerSubstringGrader,
  mustCiteGrader,
  mustNotSayGrader,
  runHarness,
  type EvalEntry,
} from '../eval-harness';

describe('answerSubstringGrader', () => {
  it('passes when every required substring appears (case-insensitive)', () => {
    const r = answerSubstringGrader(
      { answer_substrings: ['Open a PR', 'review'] },
      { answer: 'You should open a PR and request a Review.', citations: [] },
    );
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails and reports the missing substrings', () => {
    const r = answerSubstringGrader(
      { answer_substrings: ['rollback', 'feature-flag'] },
      { answer: 'Just rollback the deploy.', citations: [] },
    );
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(['feature-flag']);
  });

  it('passes vacuously when no substrings are required', () => {
    const r = answerSubstringGrader({}, { answer: 'anything', citations: [] });
    expect(r.passed).toBe(true);
  });
});

describe('mustCiteGrader', () => {
  it('passes when every required chunk is cited', () => {
    const r = mustCiteGrader(
      { must_cite: ['c1', 'c2'] },
      {
        answer: 'Per [1] and [2]…',
        citations: [{ chunk_id: 'c1' }, { chunk_id: 'c2' }, { chunk_id: 'c3' }],
      },
    );
    expect(r.passed).toBe(true);
  });

  it('fails and reports the missing chunk_ids', () => {
    const r = mustCiteGrader(
      { must_cite: ['c1', 'c2'] },
      { answer: 'Per [1]…', citations: [{ chunk_id: 'c1' }] },
    );
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(['c2']);
  });
});

describe('mustNotSayGrader', () => {
  it('passes when no forbidden string appears', () => {
    const r = mustNotSayGrader(
      { must_not_say: ['definitely', 'guaranteed'] },
      { answer: 'It usually works.', citations: [] },
    );
    expect(r.passed).toBe(true);
  });

  it('fails (case-insensitive) and reports each offender', () => {
    const r = mustNotSayGrader(
      { must_not_say: ['Definitely'] },
      { answer: 'This is definitely correct.', citations: [] },
    );
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(['Definitely']);
  });
});

describe('runHarness', () => {
  it('combines all three graders and reports pass-rate', async () => {
    const entries: EvalEntry[] = [
      {
        id: 'e1',
        organizationId: 'org',
        skillSlug: 'foo',
        question: 'q1',
        expected: { answer_substrings: ['hello'] },
        status: 'active',
      },
      {
        id: 'e2',
        organizationId: 'org',
        skillSlug: 'foo',
        question: 'q2',
        expected: { must_not_say: ['definitely'] },
        status: 'active',
      },
    ];
    const summary = await runHarness(entries, async (e) => {
      if (e.id === 'e1') return { answer: 'hello there', citations: [] };
      return { answer: 'this is definitely true', citations: [] };
    });
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.passRate).toBe(0.5);
  });

  it('returns 0 pass-rate when there are no entries', async () => {
    const summary = await runHarness([], async () => ({ answer: '', citations: [] }));
    expect(summary.total).toBe(0);
    expect(summary.passRate).toBe(0);
  });
});
