import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ErrorCode } from '@holo/errors';
import { assertEmailAllowlisted } from '../src/server';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

const ALLOWED = 'allowlist-allowed@example.com';
const BLOCKED = 'allowlist-blocked@example.com';

let pg: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = postgres(url, { max: 1 });
  db = drizzle(pg, { schema });
  // Defensive cleanup in case a prior run crashed mid-test.
  await db.delete(schema.allowedSignupEmails).where(eq(schema.allowedSignupEmails.email, ALLOWED));
  await db.delete(schema.allowedSignupEmails).where(eq(schema.allowedSignupEmails.email, BLOCKED));
  await db.insert(schema.allowedSignupEmails).values({ email: ALLOWED });
});

afterAll(async () => {
  await db.delete(schema.allowedSignupEmails).where(eq(schema.allowedSignupEmails.email, ALLOWED));
  await pg.end();
});

describe('assertEmailAllowlisted', () => {
  it('passes through when the email is allowlisted', async () => {
    await expect(assertEmailAllowlisted(db, ALLOWED)).resolves.toBeUndefined();
  });

  it('normalizes casing + whitespace before lookup', async () => {
    await expect(
      assertEmailAllowlisted(db, `  ${ALLOWED.toUpperCase()}  `),
    ).resolves.toBeUndefined();
  });

  it('throws an APIError carrying the HOLO_AUTH_NOT_ALLOWLISTED code when missing', async () => {
    // APIError shape from better-auth — we don't import the class here; we
    // just assert the surface the OAuth callback path + email-OTP client
    // actually read (status, body.code, body.message).
    await expect(assertEmailAllowlisted(db, BLOCKED)).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: {
        code: ErrorCode.HOLO_AUTH_NOT_ALLOWLISTED,
        message: ErrorCode.HOLO_AUTH_NOT_ALLOWLISTED,
      },
    });
  });
});
