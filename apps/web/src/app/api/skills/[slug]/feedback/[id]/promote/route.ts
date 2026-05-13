/**
 * POST /api/skills/[slug]/feedback/[id]/promote
 *
 * Owner/admin-only. Reads the feedback row and inserts an `eval_entries` row
 * with `status='active'`, linking back to the source feedback. The structured
 * `expected` payload (`answer_substrings`, `must_cite`, `must_not_say`) comes
 * from the request body — the inbox UI pre-fills it from the correction text
 * and the user adjusts before submitting.
 *
 * Idempotency: re-promoting the same feedback row creates a SECOND eval entry
 * by design — the owner may want to bracket multiple expectations against the
 * same example. The inbox UI surfaces a count so re-promotions are visible.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { withActiveOrg } from '@/lib/with-active-org';

const promoteBody = z.object({
  expected: z.object({
    answer_substrings: z.array(z.string()).default([]),
    must_cite: z.array(z.string()).default([]),
    must_not_say: z.array(z.string()).default([]),
  }),
  /** Overrideable; defaults to the source feedback's `question`. */
  question: z.string().min(1).optional(),
});

export const POST = withActiveOrg<{ slug: string; id: string }>(
  async ({ req, ctx, session, orgId, params }) => {
    const { db } = ctx;
    const userId = session.user.id;

    // Only owners / admins can promote feedback into eval entries — eval
    // entries gate regressions, so this is a privileged write.
    const [me] = await db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)),
      )
      .limit(1);
    if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_FORBIDDEN,
        problem: 'only workspace owners or admins can promote feedback to evals',
        fix: 'Ask an owner or admin to promote this row.',
      });
    }

    const parsed = promoteBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid promote body',
        fix: 'Send { expected: { answer_substrings, must_cite, must_not_say } }.',
      });
    }

    const [feedback] = await db
      .select({
        id: schema.answerFeedback.id,
        question: schema.answerFeedback.question,
        skillSlug: schema.answerFeedback.skillSlug,
      })
      .from(schema.answerFeedback)
      .where(
        and(
          eq(schema.answerFeedback.id, params.id),
          eq(schema.answerFeedback.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!feedback) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `feedback row ${params.id} not found in this org`,
        fix: 'Verify the id and that you are in the right workspace.',
      });
    }

    const [entry] = await db
      .insert(schema.evalEntries)
      .values({
        organizationId: orgId,
        sourceFeedbackId: feedback.id,
        skillSlug: feedback.skillSlug ?? params.slug,
        question: parsed.data.question ?? feedback.question,
        expected: parsed.data.expected,
        // Promote-to-active by default — the RFC's lifecycle is
        // pending→active→archived, but the inbox UX is "click promote
        // and it's live." A future toggle can land entries as `pending`
        // for a review queue if needed.
        status: 'active',
        createdBy: userId,
      })
      .returning({
        id: schema.evalEntries.id,
        status: schema.evalEntries.status,
      });

    return { entry };
  },
);
