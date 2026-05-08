import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { mintAccessToken, validateAccessToken, revokeAccessToken } from '../src/tokens';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let orgId: string;
let userId: string;
let clientId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);
  const orgRow = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  const userRow = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  orgId = orgRow[0]!.id;
  userId = userRow[0]!.id;
  clientId = `tok_test_client_${Date.now()}`;
  await sql`
    INSERT INTO oauth_clients (organization_id, client_id, client_name, redirect_uris, scopes)
    VALUES (${orgId}, ${clientId}, 'tokens-test', ARRAY['https://test/cb']::text[], ARRAY['search']::text[])
  `;
});

afterAll(async () => {
  await sql`DELETE FROM oauth_access_tokens WHERE client_id = ${clientId}`.catch(() => {});
  await sql`DELETE FROM oauth_clients WHERE client_id = ${clientId}`.catch(() => {});
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM oauth_access_tokens WHERE client_id = ${clientId}`;
});

function baseInput() {
  return {
    clientId,
    userId,
    organizationId: orgId,
    scopes: ['search'],
  };
}

describe('mintAccessToken + validateAccessToken', () => {
  it('mints a token and validates it back to the original principal', async () => {
    const { accessToken, expiresAt } = await mintAccessToken(db, baseInput());
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    const validated = await validateAccessToken(db, accessToken);
    expect(validated).not.toBeNull();
    expect(validated!.userId).toBe(userId);
    expect(validated!.organizationId).toBe(orgId);
    expect(validated!.scopes).toEqual(['search']);
    expect(validated!.clientId).toBe(clientId);
  });

  it('stores token_hash, never the raw token', async () => {
    const { accessToken } = await mintAccessToken(db, baseInput());
    const rows = await sql<{ token_hash: string }[]>`
      SELECT token_hash FROM oauth_access_tokens WHERE client_id = ${clientId}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.token_hash).not.toBe(accessToken);
    expect(rows[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns null for an unknown token', async () => {
    expect(await validateAccessToken(db, 'totally-not-a-real-token')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { accessToken } = await mintAccessToken(db, baseInput());
    await sql`
      UPDATE oauth_access_tokens
         SET expires_at = now() - interval '1 minute'
       WHERE client_id = ${clientId}
    `;
    expect(await validateAccessToken(db, accessToken)).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    const { accessToken } = await mintAccessToken(db, baseInput());
    const ok = await revokeAccessToken(db, accessToken);
    expect(ok).toBe(true);
    expect(await validateAccessToken(db, accessToken)).toBeNull();
  });

  it('revokeAccessToken returns false for an unknown token', async () => {
    const ok = await revokeAccessToken(db, 'totally-not-a-real-token');
    expect(ok).toBe(false);
  });

  it('revokeAccessToken on an already-revoked token returns false', async () => {
    const { accessToken } = await mintAccessToken(db, baseInput());
    await revokeAccessToken(db, accessToken);
    const second = await revokeAccessToken(db, accessToken);
    expect(second).toBe(false);
  });
});
