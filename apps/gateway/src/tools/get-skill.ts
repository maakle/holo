import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

export const getSkillInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    slug: z.string().optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((d) => d.id !== undefined || d.slug !== undefined, {
    message: 'Either id or slug must be provided',
  });

export interface GetSkillContext {
  db: DB;
  organizationId: string;
}

export async function runGetSkillTool(
  ctx: GetSkillContext,
  rawInput: unknown,
): Promise<{
  skill: {
    id: string;
    name: string;
    slug: string;
    version: number;
    status: string;
    content: string;
  } | null;
}> {
  const input = getSkillInputSchema.parse(rawInput);

  const conditions = [eq(schema.skills.organizationId, ctx.organizationId)];
  if (input.id !== undefined) conditions.push(eq(schema.skills.id, input.id));
  if (input.slug !== undefined) conditions.push(eq(schema.skills.slug, input.slug));
  if (input.version !== undefined) conditions.push(eq(schema.skills.version, input.version));

  const rows = await ctx.db
    .select({
      id: schema.skills.id,
      name: schema.skills.name,
      slug: schema.skills.slug,
      version: schema.skills.version,
      status: schema.skills.status,
      content: schema.skills.content,
    })
    .from(schema.skills)
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  if (!row) return { skill: null };
  return {
    skill: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      version: row.version,
      status: row.status,
      content: row.content,
    },
  };
}
