import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

export const listSkillsInputSchema = z.object({
  status: z.enum(['draft', 'active', 'archived']).optional().default('active'),
});

export interface ListSkillsContext {
  db: DB;
  organizationId: string;
}

export async function runListSkillsTool(
  ctx: ListSkillsContext,
  rawInput: unknown,
): Promise<{
  skills: Array<{
    id: string;
    name: string;
    slug: string;
    version: number;
    status: string;
    description: string;
  }>;
}> {
  const input = listSkillsInputSchema.parse(rawInput);
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
    .where(
      and(
        eq(schema.skills.organizationId, ctx.organizationId),
        eq(schema.skills.status, input.status),
      ),
    );

  return {
    skills: rows.map((r) => {
      const descMatch = r.content.match(/^description:\s*(.+)$/m);
      const description = descMatch ? (descMatch[1] ?? '').trim() : '';
      return { id: r.id, name: r.name, slug: r.slug, version: r.version, status: r.status, description };
    }),
  };
}
