/**
 * RFC-0008 (slack extension). Maps a slack `reaction_added` event on a bot
 * reply to an `answer_feedback` row. We:
 *
 *   1. Look up the bot reply in `slack_answer_index` by (team, channel, ts).
 *      No hit → the reaction was on a message we didn't author (or one we
 *      never indexed); skip silently.
 *   2. Resolve the reacting slack user to a holo user via
 *      `slack_user_credentials`. No mapping → the reactor hasn't OAuth'd
 *      with holo yet; skip with a debug log rather than fabricating
 *      attribution.
 *   3. Convert the emoji to a numeric rating (-1 | 0 | 1) via
 *      `reactionToRating`. Unknown emoji → skip; we don't want every
 *      :tada: aliased to "thumbs-up" by accident.
 *   4. Insert into `answer_feedback`, idempotent on (answer_id, user_id):
 *      a member changing 👎 → 👍 (`reaction_added`+`reaction_removed`)
 *      overwrites the prior rating.
 *
 * No slack API calls in the hot path — everything we need is on the index
 * row written at reply time.
 */
import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { SlackBotJob } from './handler.js';

type ReactionJob = Extract<SlackBotJob, { kind: 'reaction_added' }>;

/**
 * Public for testing. Anything that isn't an unambiguous up- or down-vote
 * returns null so we can skip rather than guess.
 */
export function reactionToRating(reaction: string): -1 | 0 | 1 | null {
  // Strip skin-tone modifiers slack appends (`+1::skin-tone-3` → `+1`).
  const core = reaction.split('::')[0]!;
  if (core === '+1' || core === 'thumbsup' || core === 'white_check_mark') return 1;
  if (core === '-1' || core === 'thumbsdown' || core === 'x') return -1;
  return null;
}

export async function handleFeedbackReaction(
  job: ReactionJob,
  db: DB,
  logInfo: (msg: string, fields?: Record<string, unknown>) => void,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rating = reactionToRating(job.reaction);
  if (rating === null) {
    return { ok: false, reason: 'reaction_not_a_rating' };
  }

  // 1. The bot message must have been indexed at reply time.
  const indexed = await db
    .select({
      organizationId: schema.slackAnswerIndex.organizationId,
      answerId: schema.slackAnswerIndex.answerId,
      question: schema.slackAnswerIndex.question,
      answer: schema.slackAnswerIndex.answer,
      sourcesJsonb: schema.slackAnswerIndex.sourcesJsonb,
    })
    .from(schema.slackAnswerIndex)
    .where(
      and(
        eq(schema.slackAnswerIndex.slackTeamId, job.teamId),
        eq(schema.slackAnswerIndex.slackChannel, job.channel),
        eq(schema.slackAnswerIndex.slackTs, job.messageTs),
      ),
    )
    .limit(1);
  const row = indexed[0];
  if (!row) {
    logInfo('slack-bot: reaction on non-indexed message, skipping', {
      teamId: job.teamId,
      channel: job.channel,
      messageTs: job.messageTs,
    });
    return { ok: false, reason: 'message_not_indexed' };
  }

  // 2. Resolve the reactor's slack user to a holo user.
  const reactor = await db
    .select({ userId: schema.slackUserCredentials.userId })
    .from(schema.slackUserCredentials)
    .where(
      and(
        eq(schema.slackUserCredentials.organizationId, row.organizationId),
        eq(schema.slackUserCredentials.slackUserId, job.asker),
      ),
    )
    .limit(1);
  if (!reactor[0]) {
    logInfo('slack-bot: reactor has no holo user mapping, skipping', {
      organizationId: row.organizationId,
      slackUserId: job.asker,
    });
    return { ok: false, reason: 'reactor_not_mapped' };
  }
  const userId = reactor[0].userId;

  // 3. `reaction_removed` mirrors as a delete on (answer_id, user_id) so the
  // user can undo a vote. We could otherwise leave the row, but then a 👎
  // followed by un-👎 would still count as -1, which is misleading.
  if (job.removed) {
    await db
      .delete(schema.answerFeedback)
      .where(
        and(
          eq(schema.answerFeedback.answerId, row.answerId),
          eq(schema.answerFeedback.userId, userId),
        ),
      );
    return { ok: true };
  }

  // 4. Insert / overwrite. The unique (answer_id, user_id) constraint makes
  // this idempotent: re-reacting with a different emoji updates the rating
  // in place. citations + coverage are empty arrays for slack-origin
  // feedback — RFC-0008's eval-promotion path handles that by skipping
  // must_cite graders on entries with no citations.
  await db
    .insert(schema.answerFeedback)
    .values({
      organizationId: row.organizationId,
      userId,
      answerId: row.answerId,
      rating,
      question: row.question,
      answer: row.answer,
      citationsJsonb: [],
      coverageJsonb: [],
    })
    .onConflictDoUpdate({
      target: [schema.answerFeedback.answerId, schema.answerFeedback.userId],
      set: { rating, correctionText: null },
    });
  return { ok: true };
}
