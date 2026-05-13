/**
 * POST /api/feedback — first-party same-origin feedback endpoint used by the
 * chat panel's inline rating bar. Mirrors the gateway `/v1/feedback` REST
 * surface but reads the active session via cookies (vs. bearer token).
 *
 * Idempotent on (answer_id, user_id) — re-submitting overwrites the prior
 * rating/correction (UPSERT). See RFC-0008.
 */

import { z } from 'zod';
import { schema } from '@holo/db';
import { ErrorCode, holoError } from '@holo/errors';
import { withActiveOrg } from '@/lib/with-active-org';

const bodySchema = z.object({
  answer_id: z.string().uuid(),
  rating: z.number().int().min(-1).max(1),
  correction_text: z.string().max(8_000).optional(),
  skill_slug: z.string().optional(),
  denorm: z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
    citations: z.array(z.unknown()).default([]),
    coverage: z.array(z.unknown()).default([]),
  }),
});

export const POST = withActiveOrg(async ({ req, ctx, session, orgId }) => {
  const { db } = ctx;
  const userId = session.user.id;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'invalid feedback body',
      fix: 'Send { answer_id, rating, denorm: { question, answer, citations, coverage } }.',
    });
  }
  const body = parsed.data;

  const inserted = await db
    .insert(schema.answerFeedback)
    .values({
      organizationId: orgId,
      userId,
      answerId: body.answer_id,
      skillSlug: body.skill_slug ?? null,
      rating: body.rating,
      correctionText: body.correction_text ?? null,
      question: body.denorm.question,
      answer: body.denorm.answer,
      citationsJsonb: body.denorm.citations,
      coverageJsonb: body.denorm.coverage,
    })
    .onConflictDoUpdate({
      target: [schema.answerFeedback.answerId, schema.answerFeedback.userId],
      set: {
        rating: body.rating,
        correctionText: body.correction_text ?? null,
        question: body.denorm.question,
        answer: body.denorm.answer,
        citationsJsonb: body.denorm.citations,
        coverageJsonb: body.denorm.coverage,
      },
    })
    .returning({
      id: schema.answerFeedback.id,
      answerId: schema.answerFeedback.answerId,
      rating: schema.answerFeedback.rating,
      createdAt: schema.answerFeedback.createdAt,
    });
  const row = inserted[0]!;
  return {
    id: row.id,
    answer_id: row.answerId,
    rating: row.rating,
    created_at: row.createdAt.toISOString(),
  };
});
