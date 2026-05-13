/**
 * Pure-unit tests for the slack reaction → feedback mapper. The `reactionToRating`
 * regression cases need no DB; the `handleFeedbackReaction` orchestration is
 * exercised against a small in-memory DB stub that mirrors the three drizzle
 * surfaces it uses (select+limit, insert+onConflictDoUpdate, delete).
 *
 * Skipped: live-DB integration (covered indirectly by the existing
 * slack-bot-handler.test.ts harness on the rest of the slack flow).
 */
import { describe, expect, it } from 'vitest';
import {
  handleFeedbackReaction,
  reactionToRating,
} from '../src/slack-bot/feedback-reaction.js';
import type { SlackBotJob } from '../src/slack-bot/handler.js';

describe('reactionToRating', () => {
  it('+1 / thumbsup / white_check_mark map to 1', () => {
    expect(reactionToRating('+1')).toBe(1);
    expect(reactionToRating('thumbsup')).toBe(1);
    expect(reactionToRating('white_check_mark')).toBe(1);
  });
  it('-1 / thumbsdown / x map to -1', () => {
    expect(reactionToRating('-1')).toBe(-1);
    expect(reactionToRating('thumbsdown')).toBe(-1);
    expect(reactionToRating('x')).toBe(-1);
  });
  it('strips skin-tone modifiers slack appends', () => {
    expect(reactionToRating('+1::skin-tone-3')).toBe(1);
    expect(reactionToRating('thumbsdown::skin-tone-5')).toBe(-1);
  });
  it('returns null for ambiguous / non-vote reactions — we skip rather than guess', () => {
    expect(reactionToRating('tada')).toBe(null);
    expect(reactionToRating('eyes')).toBe(null);
    expect(reactionToRating('fire')).toBe(null);
    expect(reactionToRating('')).toBe(null);
  });
});

type IndexedRow = {
  organizationId: string;
  answerId: string;
  question: string;
  answer: string;
  sourcesJsonb: unknown;
};
type ReactorRow = { userId: string };
type WriteCall = { op: 'insert' | 'delete'; payload?: unknown };

// Stubs the drizzle handle that `handleFeedbackReaction` calls into. The
// handler does, in order: one select against `slack_answer_index`, then one
// select against `slack_user_credentials`, then either an insert into
// `answer_feedback` or a delete from it. We count selects so each lookup
// returns the configured row independently.
function makeFakeDb(opts: { indexed: IndexedRow | null; reactor: ReactorRow | null }) {
  const writes: WriteCall[] = [];
  let selectCount = 0;
  const chain = {
    select() {
      selectCount += 1;
      return chain;
    },
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      if (selectCount === 1) return opts.indexed ? [opts.indexed] : [];
      if (selectCount === 2) return opts.reactor ? [opts.reactor] : [];
      return [];
    },
    insert() {
      return chain;
    },
    values(v: unknown) {
      writes.push({ op: 'insert', payload: v });
      return chain;
    },
    onConflictDoUpdate() {
      return Promise.resolve();
    },
    onConflictDoNothing() {
      return Promise.resolve();
    },
    delete() {
      writes.push({ op: 'delete' });
      return chain;
    },
  };
  return { db: chain, writes };
}

const ratingJob: Extract<SlackBotJob, { kind: 'reaction_added' }> = {
  kind: 'reaction_added',
  teamId: 'T-test',
  channel: 'C-test',
  messageTs: '123.456',
  asker: 'U-test',
  reaction: '+1',
  removed: false,
};

describe('handleFeedbackReaction', () => {
  it('inserts a thumbs-up feedback row when the message is indexed and the reactor is mapped', async () => {
    const { db, writes } = makeFakeDb({
      indexed: {
        organizationId: 'org-1',
        answerId: 'ans-1',
        question: 'what is x?',
        answer: 'x is foo',
        sourcesJsonb: [],
      },
      reactor: { userId: 'user-1' },
    });
    const res = await handleFeedbackReaction(ratingJob, db as never, () => {});
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.op).toBe('insert');
    const payload = writes[0]!.payload as { rating: number; answerId: string; userId: string };
    expect(payload.rating).toBe(1);
    expect(payload.answerId).toBe('ans-1');
    expect(payload.userId).toBe('user-1');
  });

  it('skips silently when the reacted-to message was never indexed', async () => {
    const { db, writes } = makeFakeDb({ indexed: null, reactor: { userId: 'user-1' } });
    const res = await handleFeedbackReaction(ratingJob, db as never, () => {});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toBe('message_not_indexed');
    expect(writes).toHaveLength(0);
  });

  it('skips when the reactor has no holo user mapping (no slack_user_credentials row)', async () => {
    const { db, writes } = makeFakeDb({
      indexed: {
        organizationId: 'org-1',
        answerId: 'ans-1',
        question: 'q',
        answer: 'a',
        sourcesJsonb: [],
      },
      reactor: null,
    });
    const res = await handleFeedbackReaction(ratingJob, db as never, () => {});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toBe('reactor_not_mapped');
    expect(writes).toHaveLength(0);
  });

  it('skips when the emoji is not a vote (e.g. :tada:)', async () => {
    const job = { ...ratingJob, reaction: 'tada' };
    const { db, writes } = makeFakeDb({
      indexed: {
        organizationId: 'org-1',
        answerId: 'ans-1',
        question: 'q',
        answer: 'a',
        sourcesJsonb: [],
      },
      reactor: { userId: 'user-1' },
    });
    const res = await handleFeedbackReaction(job, db as never, () => {});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.reason).toBe('reaction_not_a_rating');
    expect(writes).toHaveLength(0);
  });

  it('mirrors reaction_removed as a delete on the (answer_id, user_id) row', async () => {
    const job = { ...ratingJob, removed: true };
    const { db, writes } = makeFakeDb({
      indexed: {
        organizationId: 'org-1',
        answerId: 'ans-1',
        question: 'q',
        answer: 'a',
        sourcesJsonb: [],
      },
      reactor: { userId: 'user-1' },
    });
    const res = await handleFeedbackReaction(job, db as never, () => {});
    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.op).toBe('delete');
  });
});
