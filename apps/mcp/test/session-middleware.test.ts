import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import { schema } from '@memex/db';
import { createSessionMiddleware } from '../src/middleware/session';
import { MemexError } from '@memex/errors';

const url = process.env.DATABASE_URL ?? 'postgresql://memex:memex@localhost:5436/memex';
let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;
let userId: string;

beforeAll(async () => {
  pg = postgres(url, { max: 1 });
  db = drizzle(pg, { schema });
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(drizzleSql`slug='default'`);
  const inserted = await db
    .insert(schema.user)
    .values({ email: 'mcp-mw@example.com', organizationId: orgs[0]!.id })
    .onConflictDoUpdate({ target: schema.user.email, set: { updatedAt: new Date() } })
    .returning({ id: schema.user.id });
  userId = inserted[0]!.id;

  await db.delete(schema.session).where(drizzleSql`token='mw-token'`);
  await db.insert(schema.session).values({
    userId,
    token: 'mw-token',
    expiresAt: new Date(Date.now() + 3600_000),
  });
});

afterAll(async () => {
  await db.delete(schema.session).where(drizzleSql`token='mw-token'`);
  await db.delete(schema.user).where(drizzleSql`email='mcp-mw@example.com'`);
  await pg.end();
});

describe('createSessionMiddleware', () => {
  function buildApp() {
    const app = new Hono()
      .use('*', createSessionMiddleware(db as never))
      .get('/me', (c) => c.json(c.get('user' as never)));
    app.onError((err, c) =>
      err instanceof MemexError ? c.json(err.toJSON(), 401) : c.json({}, 500),
    );
    return app;
  }

  it('attaches user when cookie valid', async () => {
    const app = buildApp();
    const res = await app.request('/me', {
      headers: { cookie: 'better-auth.session_token=mw-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(userId);
  });

  it('returns 401 with MemexError JSON when cookie missing', async () => {
    const app = buildApp();
    const res = await app.request('/me');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('MEMEX_AUTH_NO_SESSION');
  });
});
