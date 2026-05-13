import { z } from 'zod';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

/**
 * MCP `submit_feedback` tool — server-side mirror of `POST /v1/feedback`.
 *
 * Why an MCP tool: a sub-agent / second pass running over the assistant's
 * answer can call this directly to flag a regression without round-tripping
 * to the user. Same insert path, same idempotency.
 *
 * Required `userId` on the context: feedback is per-user, never anonymous.
 */
export const submitFeedbackInputSchema = z.object({
  answer_id: z.uuid(),
  rating: z.number().int().min(-1).max(1),
  correction_text: z.string().max(8_000).optional(),
  skill_slug: z.string().optional(),
  question: z.string().min(1),
  answer: z.string().min(1),
  citations: z.array(z.unknown()).default([]),
  coverage: z.array(z.unknown()).default([]),
});

export interface SubmitFeedbackContext {
  db: DB;
  organizationId: string;
  userId?: string;
}

export async function runSubmitFeedbackTool(
  ctx: SubmitFeedbackContext,
  rawInput: unknown,
): Promise<{
  id: string;
  answer_id: string;
  rating: number;
  created_at: string;
}> {
  const input = submitFeedbackInputSchema.parse(rawInput);
  if (!ctx.userId) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'submit_feedback requires an authenticated user; ctx.userId is missing.',
      fix: 'Authenticate the MCP session before calling submit_feedback.',
    });
  }

  const inserted = await ctx.db
    .insert(schema.answerFeedback)
    .values({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      answerId: input.answer_id,
      skillSlug: input.skill_slug ?? null,
      rating: input.rating,
      correctionText: input.correction_text ?? null,
      question: input.question,
      answer: input.answer,
      citationsJsonb: input.citations,
      coverageJsonb: input.coverage,
    })
    .onConflictDoUpdate({
      target: [schema.answerFeedback.answerId, schema.answerFeedback.userId],
      set: {
        rating: input.rating,
        correctionText: input.correction_text ?? null,
        question: input.question,
        answer: input.answer,
        citationsJsonb: input.citations,
        coverageJsonb: input.coverage,
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
}
