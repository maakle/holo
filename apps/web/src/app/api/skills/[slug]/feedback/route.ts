/**
 * GET /api/skills/[slug]/feedback — list recent feedback rows for a skill.
 *
 * Filters to the active organization. Returns newest-first; the skill feedback
 * inbox UI paginates by `limit` (default 50).
 *
 * Access: any member of the org can read (mirrors the existing skill detail
 * read pattern). Promotion to eval_entries is the privileged action — see
 * `./[id]/promote/route.ts`.
 */

import { desc, eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { withActiveOrg } from '@/lib/with-active-org';

export const GET = withActiveOrg<{ slug: string }>(async ({ ctx, orgId, params, req }) => {
  const { db } = ctx;
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const rows = await db
    .select({
      id: schema.answerFeedback.id,
      answerId: schema.answerFeedback.answerId,
      rating: schema.answerFeedback.rating,
      correctionText: schema.answerFeedback.correctionText,
      question: schema.answerFeedback.question,
      answer: schema.answerFeedback.answer,
      createdAt: schema.answerFeedback.createdAt,
      userId: schema.answerFeedback.userId,
    })
    .from(schema.answerFeedback)
    .where(
      and(
        eq(schema.answerFeedback.organizationId, orgId),
        eq(schema.answerFeedback.skillSlug, params.slug),
      ),
    )
    .orderBy(desc(schema.answerFeedback.createdAt))
    .limit(limit);

  return { feedback: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
});
