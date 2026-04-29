import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { schema } from '@memex/db';
import { validateSessionCookie, readSessionCookie } from '../src/mcp-session';
import { MemexError } from '@memex/errors';

const url = process.env.DATABASE_URL ?? 'postgresql://memex:memex@localhost:5436/memex';
let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let userId: string;
let orgId: string;

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

  await db.delete(schema.session).where(drizzleSql`token = 'test-token-abc'`);
  await db.insert(schema.session).values({
    userId,
    token: 'test-token-abc',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
});

afterAll(async () => {
  await db.delete(schema.session).where(drizzleSql`token = 'test-token-abc'`);
  await db.delete(schema.user).where(drizzleSql`email = 'mcp-test@example.com'`);
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

  it('throws MEMEX_AUTH_NO_SESSION when no cookie', async () => {
    await expect(validateSessionCookie(db as never, undefined)).rejects.toThrow(MemexError);
  });

  it('throws MEMEX_AUTH_NO_SESSION when token is unknown', async () => {
    await expect(
      validateSessionCookie(db as never, 'better-auth.session_token=does-not-exist'),
    ).rejects.toThrow(MemexError);
  });
});
