import type { DB } from './client.js';
import { organization } from './schema/auth.js';
import { sql } from 'drizzle-orm';

export const DEFAULT_ORG_SLUG = 'default';

export async function seedDefaultOrganization(db: DB): Promise<{ id: string }> {
  const existing = await db
    .select({ id: organization.id })
    .from(organization)
    .where(sql`${organization.slug} = ${DEFAULT_ORG_SLUG}`);
  if (existing[0]) return { id: existing[0].id };

  const inserted = await db
    .insert(organization)
    .values({
      name: 'Default',
      slug: DEFAULT_ORG_SLUG,
    })
    .returning({ id: organization.id });

  return { id: inserted[0]!.id };
}
