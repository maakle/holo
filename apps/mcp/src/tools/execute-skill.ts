import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { parseSkill, executeSkill } from '@holo/skills';
import { holoError, ErrorCode } from '@holo/errors';

export const executeSkillInputSchema = z.object({
  skillSlug: z.string().min(1),
  query: z.string().min(1).describe('The user query or task triggering this skill execution'),
  version: z.number().int().optional(),
});

export interface ExecuteSkillToolContext {
  db: DB;
  organizationId: string;
  anthropicApiKey: string | undefined;
}

export async function runExecuteSkillTool(
  ctx: ExecuteSkillToolContext,
  rawInput: unknown,
): Promise<{
  runId: string;
  skillName: string;
  steps: Array<{ stepIndex: number; stepText: string; response: string }>;
  summary: string;
}> {
  const input = executeSkillInputSchema.parse(rawInput);

  if (!ctx.anthropicApiKey) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'ANTHROPIC_API_KEY is required for skill execution',
      fix: 'Set ANTHROPIC_API_KEY in your environment',
    });
  }

  const conditions = [
    eq(schema.skills.organizationId, ctx.organizationId),
    eq(schema.skills.slug, input.skillSlug),
    eq(schema.skills.status, 'active' as const),
  ];
  if (input.version !== undefined) {
    conditions.push(eq(schema.skills.version, input.version));
  }

  const rows = await ctx.db
    .select()
    .from(schema.skills)
    .where(and(...conditions))
    .orderBy(desc(schema.skills.version))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `Skill '${input.skillSlug}' not found or not active`,
      fix: 'Check the skill slug and ensure it has status=active',
    });
  }

  if (!row.executable) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Skill '${input.skillSlug}' is not marked executable`,
      fix: 'Add executable: true to the skill frontmatter and re-synthesize',
    });
  }

  const skillDoc = parseSkill(row.content);

  const [runRow] = await ctx.db
    .insert(schema.skillRuns)
    .values({
      organizationId: ctx.organizationId,
      skillId: row.id,
      input: { query: input.query } as Record<string, unknown>,
      status: 'running',
    })
    .returning({ id: schema.skillRuns.id });

  if (!runRow) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: 'Failed to create skill run record',
      fix: 'Check database connectivity',
    });
  }

  let result;
  try {
    result = await executeSkill({
      skill: skillDoc,
      userQuery: input.query,
      apiKey: ctx.anthropicApiKey,
    });
  } catch (err) {
    await ctx.db
      .update(schema.skillRuns)
      .set({ status: 'failed', errorMessage: String(err), completedAt: new Date() })
      .where(eq(schema.skillRuns.id, runRow.id));
    throw err;
  }

  await ctx.db
    .update(schema.skillRuns)
    .set({
      steps: result.steps as unknown as unknown[],
      status: 'completed',
      completedAt: new Date(),
    })
    .where(eq(schema.skillRuns.id, runRow.id));

  return {
    runId: runRow.id,
    skillName: skillDoc.frontmatter.name,
    steps: result.steps.map((s) => ({
      stepIndex: s.stepIndex,
      stepText: s.stepText,
      response: s.llmResponse,
    })),
    summary: result.summary,
  };
}
