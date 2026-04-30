import { createDb, schema } from '@holo/db';
import type { DB } from '@holo/db';
import { and, eq } from 'drizzle-orm';

export function makeTestDb(): DB {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  return createDb(url);
}

export interface AllowlistRowInput {
  pattern: string;
  patternKind: 'glob' | 'exact_id';
  decision: 'include' | 'exclude';
}

/**
 * Seeds allowlist rows for the given org/provider.
 */
export async function seedAllowlistRows(
  db: DB,
  orgId: string,
  userId: string,
  provider: string,
  rows: AllowlistRowInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(schema.connectorAllowlists).values(
    rows.map((r) => ({
      organizationId: orgId,
      provider,
      pattern: r.pattern,
      patternKind: r.patternKind,
      decision: r.decision,
      createdBy: userId,
    })),
  );
}

/**
 * Remove all connector_allowlists rows for a given org + provider.
 */
export async function cleanAllowlistRows(
  db: DB,
  orgId: string,
  provider: string,
): Promise<void> {
  await db
    .delete(schema.connectorAllowlists)
    .where(
      and(
        eq(schema.connectorAllowlists.organizationId, orgId),
        eq(schema.connectorAllowlists.provider, provider),
      ),
    );
}

/**
 * Ensure a test org + user exist, returning their IDs.
 * Uses a dedicated slug so tests never collide with real data.
 */
export async function ensureTestOrgAndUser(
  db: DB,
): Promise<{ orgId: string; userId: string }> {
  const TEST_ORG_SLUG = 'test-allowlist';
  const TEST_USER_EMAIL = 'test-allowlist@holo.test';

  // Upsert org
  const existingOrgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, TEST_ORG_SLUG))
    .limit(1);

  let orgId: string;
  if (existingOrgs[0]) {
    orgId = existingOrgs[0].id;
  } else {
    const inserted = await db
      .insert(schema.organization)
      .values({ name: 'Test Allowlist Org', slug: TEST_ORG_SLUG })
      .returning({ id: schema.organization.id });
    orgId = inserted[0]!.id;
  }

  // Upsert user
  const existingUsers = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, TEST_USER_EMAIL))
    .limit(1);

  let userId: string;
  if (existingUsers[0]) {
    userId = existingUsers[0].id;
  } else {
    const inserted = await db
      .insert(schema.user)
      .values({
        email: TEST_USER_EMAIL,
        name: 'Test Allowlist User',
        organizationId: orgId,
      })
      .returning({ id: schema.user.id });
    userId = inserted[0]!.id;
  }

  return { orgId, userId };
}
