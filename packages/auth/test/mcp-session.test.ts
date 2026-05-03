import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { validateSessionCookie, readSessionCookie } from '../src/mcp-session';
import { HoloError } from '@holo/errors';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let userId: string;
let orgId: string;
let secondOrgId: string;

beforeAll(async () => {
  pg = postgres(url, { max: 1 });
  db = drizzle(pg, { schema });

  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(drizzleSql`slug = 'default'`);
  orgId = orgs[0]!.id;

  const inserted = await db
    .insert(schema.user)
    .values({ email: 'mcp-test@example.com', organizationId: orgId })
    .onConflictDoUpdate({ target: schema.user.email, set: { updatedAt: new Date() } })
    .returning({ id: schema.user.id });
  userId = inserted[0]!.id;

  // Second org for multi-tenancy tests; the test user is *not* a member here.
  await db.delete(schema.organization).where(drizzleSql`slug = 'mcp-test-secondary'`);
  const second = await db
    .insert(schema.organization)
    .values({ name: 'Secondary', slug: 'mcp-test-secondary' })
    .returning({ id: schema.organization.id });
  secondOrgId = second[0]!.id;

  await db.delete(schema.session).where(drizzleSql`token = 'test-token-abc'`);
  await db.insert(schema.session).values({
    userId,
    token: 'test-token-abc',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
});

afterAll(async () => {
  await db.delete(schema.session).where(drizzleSql`token = 'test-token-abc'`);
  await db.delete(schema.member).where(drizzleSql`user_id = ${userId}`);
  await db.delete(schema.user).where(drizzleSql`email = 'mcp-test@example.com'`);
  await db.delete(schema.organization).where(drizzleSql`slug = 'mcp-test-secondary'`);
  await pg.end();
});

describe('readSessionCookie', () => {
  it('parses better-auth.session_token from a Cookie header', () => {
    expect(readSessionCookie('better-auth.session_token=abc.sig')).toBe('abc.sig');
    expect(readSessionCookie('foo=bar; better-auth.session_token=xyz')).toBe('xyz');
  });

  it('returns null when missing', () => {
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie('foo=bar')).toBeNull();
  });
});

describe('validateSessionCookie', () => {
  it('resolves a valid cookie to user + organization', async () => {
    const cookie = 'better-auth.session_token=test-token-abc.signature-ignored';
    const result = await validateSessionCookie(db as never, cookie);
    expect(result.userId).toBe(userId);
    expect(result.organizationId).toBe(orgId);
    expect(result.email).toBe('mcp-test@example.com');
  });

  it('throws HOLO_AUTH_NO_SESSION when no cookie', async () => {
    await expect(validateSessionCookie(db as never, undefined)).rejects.toThrow(HoloError);
  });

  it('throws HOLO_AUTH_NO_SESSION when token is unknown', async () => {
    await expect(
      validateSessionCookie(db as never, 'better-auth.session_token=does-not-exist'),
    ).rejects.toThrow(HoloError);
  });

  it('honors session.activeOrganizationId when user is a member of that org', async () => {
    // Make the test user a member of the secondary org and switch active org.
    await db.insert(schema.member).values({
      userId,
      organizationId: secondOrgId,
      role: 'owner',
    });
    await db
      .update(schema.session)
      .set({ activeOrganizationId: secondOrgId })
      .where(drizzleSql`token = 'test-token-abc'`);

    const cookie = 'better-auth.session_token=test-token-abc.signature-ignored';
    const result = await validateSessionCookie(db as never, cookie);
    expect(result.organizationId).toBe(secondOrgId);

    // Reset for subsequent tests.
    await db
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(drizzleSql`token = 'test-token-abc'`);
    await db.delete(schema.member).where(drizzleSql`user_id = ${userId}`);
  });

  it('falls back to home org when active org is set but user is not a member', async () => {
    // Stale activeOrganizationId pointing at an org the user does not belong to.
    await db
      .update(schema.session)
      .set({ activeOrganizationId: secondOrgId })
      .where(drizzleSql`token = 'test-token-abc'`);

    const cookie = 'better-auth.session_token=test-token-abc.signature-ignored';
    const result = await validateSessionCookie(db as never, cookie);
    expect(result.organizationId).toBe(orgId);

    await db
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(drizzleSql`token = 'test-token-abc'`);
  });
});
