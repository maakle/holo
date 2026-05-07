import type { DB } from './client';
import { member, organization, user } from './schema/auth';
import { sql, eq, and } from 'drizzle-orm';
import { ensureSampleData } from './sample-data';

export const DEFAULT_ORG_SLUG = 'default';
export const DEFAULT_USER_EMAIL = 'default@holo.local';

export async function seedDefaultOrganization(db: DB): Promise<{ id: string }> {
  const existing = await db
    .select({ id: organization.id })
    .from(organization)
    .where(sql`${organization.slug} = ${DEFAULT_ORG_SLUG}`);
  if (existing[0]) {
    await ensureDefaultUser(db, existing[0].id);
    await ensureSampleData(db, existing[0].id);
    return { id: existing[0].id };
  }

  const inserted = await db
    .insert(organization)
    .values({
      name: 'Default',
      slug: DEFAULT_ORG_SLUG,
    })
    .returning({ id: organization.id });

  const orgId = inserted[0]!.id;
  await ensureDefaultUser(db, orgId);
  await ensureSampleData(db, orgId);
  return { id: orgId };
}

/**
 * Idempotently seed a default user bound to the default org, plus their
 * `member` row so the Better Auth org plugin treats them as a real member.
 *
 * Tests that touch real DB rows often need a user to exist (FKs from
 * `oauth_*`, `slack_user_credentials`, `user_subjects_cache`, etc.). Without
 * this, fresh CI databases have no user and tests using
 * `SELECT id FROM "user" LIMIT 1` return zero rows. This is part of `migrate`
 * (not a separate `seed:test` script) so any environment that runs migrations
 * gets the default user for free.
 */
async function ensureDefaultUser(db: DB, organizationId: string): Promise<void> {
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, DEFAULT_USER_EMAIL));

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    const inserted = await db
      .insert(user)
      .values({
        email: DEFAULT_USER_EMAIL,
        name: 'Default User',
        emailVerified: true,
        organizationId,
      })
      .returning({ id: user.id });
    userId = inserted[0]!.id;
  }

  const existingMember = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  if (existingMember[0]) return;

  await db.insert(member).values({
    userId,
    organizationId,
    role: 'owner',
  });
}
