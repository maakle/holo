import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql, eq, and } from 'drizzle-orm';
import { removeSampleData, schema } from '@holo/db';
import { provisionPersonalOrgOnSignup } from '../src/server';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

const EMAILS = [
  'signup-personal-org-test@example.com',
  'signup-invited-test@example.com',
  'signup-existing-member-test@example.com',
] as const;

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let defaultOrgId: string;
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

beforeAll(async () => {
  pg = postgres(url, { max: 1 });
  db = drizzle(pg, { schema });

  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(drizzleSql`slug = 'default'`);
  defaultOrgId = orgs[0]!.id;

  // Defensive cleanup of leftover rows from prior runs that crashed mid-test.
  for (const email of EMAILS) {
    await db.delete(schema.invitation).where(eq(schema.invitation.email, email));
    const stale = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email));
    for (const row of stale) {
      await db.delete(schema.member).where(eq(schema.member.userId, row.id));
      await db.delete(schema.user).where(eq(schema.user.id, row.id));
    }
  }
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(schema.member).where(eq(schema.member.userId, userId));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }
  for (const orgId of createdOrgIds) {
    // Sample data is seeded on signup; sources/source_artifacts/chunks
    // don't cascade-delete with the org, so clear them before dropping it.
    await removeSampleData(db, orgId);
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
  }
  for (const email of EMAILS) {
    await db.delete(schema.invitation).where(eq(schema.invitation.email, email));
  }
  await pg.end();
});

describe('provisionPersonalOrgOnSignup', () => {
  it('creates a personal org owned by the user and never makes them a member of the default org', async () => {
    const email = 'signup-personal-org-test@example.com';

    // Mirror what better-auth does at INSERT time: user row with organizationId
    // set to the default org via the additionalFields default. The hook is
    // expected to repoint this away from default.
    const [u] = await db
      .insert(schema.user)
      .values({ email, name: 'Mathias', organizationId: defaultOrgId })
      .returning({ id: schema.user.id });
    createdUserIds.push(u!.id);

    const result = await provisionPersonalOrgOnSignup(db, {
      id: u!.id,
      email,
      name: 'Mathias',
    });

    expect(result.created).toBe(true);
    if (!result.created) throw new Error('unreachable');
    expect(result.organizationId).not.toBe(defaultOrgId);
    createdOrgIds.push(result.organizationId);

    // The security invariant: NO membership in default for this user.
    const defaultMembership = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(eq(schema.member.userId, u!.id), eq(schema.member.organizationId, defaultOrgId)),
      );
    expect(defaultMembership).toHaveLength(0);

    // The user IS owner of exactly one org — the personal one.
    const memberships = await db
      .select({ organizationId: schema.member.organizationId, role: schema.member.role })
      .from(schema.member)
      .where(eq(schema.member.userId, u!.id));
    expect(memberships).toEqual([{ organizationId: result.organizationId, role: 'owner' }]);

    // user.organizationId was repointed away from default.
    const userRow = await db
      .select({ organizationId: schema.user.organizationId })
      .from(schema.user)
      .where(eq(schema.user.id, u!.id));
    expect(userRow[0]!.organizationId).toBe(result.organizationId);

    // Org name follows the "{name}'s workspace" convention.
    const orgRow = await db
      .select({ name: schema.organization.name, slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, result.organizationId));
    expect(orgRow[0]!.name).toBe("Mathias's workspace");
    expect(orgRow[0]!.slug.startsWith('mathias-')).toBe(true);

    // Sample Star Wars data is seeded on signup so the new workspace shows
    // live content immediately. Asserting via the sample source row keeps
    // this resilient to artifact-count tweaks.
    const sampleSource = await db
      .select({ id: schema.sources.id })
      .from(schema.sources)
      .where(
        and(
          eq(schema.sources.organizationId, result.organizationId),
          eq(schema.sources.provider, 'sample'),
        ),
      );
    expect(sampleSource).toHaveLength(1);
  });

  it('skips when there is a pending invitation for the email (acceptInvitation will handle membership)', async () => {
    const email = 'signup-invited-test@example.com';

    // Need an inviter with a real user row. The seeded default user is the
    // safest choice — it's created by the migrate seed and exists in every env.
    const inviter = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, 'default@holo.local'));
    const inviterId = inviter[0]!.id;

    await db.insert(schema.invitation).values({
      organizationId: defaultOrgId,
      email,
      role: 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      inviterId,
    });

    const [u] = await db
      .insert(schema.user)
      .values({ email, organizationId: defaultOrgId })
      .returning({ id: schema.user.id });
    createdUserIds.push(u!.id);

    const result = await provisionPersonalOrgOnSignup(db, { id: u!.id, email });

    expect(result).toEqual({ created: false, reason: 'pending_invite' });

    const memberships = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.userId, u!.id));
    expect(memberships).toHaveLength(0);
  });

  it('skips when the user already has any member row (idempotent re-entry)', async () => {
    const email = 'signup-existing-member-test@example.com';

    const [u] = await db
      .insert(schema.user)
      .values({ email, organizationId: defaultOrgId })
      .returning({ id: schema.user.id });
    createdUserIds.push(u!.id);

    const [pre] = await db
      .insert(schema.organization)
      .values({
        name: 'Pre-existing',
        slug: `signup-existing-${crypto.randomUUID().slice(0, 6)}`,
      })
      .returning({ id: schema.organization.id });
    createdOrgIds.push(pre!.id);
    await db.insert(schema.member).values({
      userId: u!.id,
      organizationId: pre!.id,
      role: 'member',
    });

    const result = await provisionPersonalOrgOnSignup(db, { id: u!.id, email });

    expect(result).toEqual({ created: false, reason: 'existing_member' });

    const memberships = await db
      .select({ organizationId: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, u!.id));
    expect(memberships).toEqual([{ organizationId: pre!.id }]);
  });
});
