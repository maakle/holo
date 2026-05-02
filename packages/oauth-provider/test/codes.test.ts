import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { mintAuthCode, consumeAuthCode } from '../src/codes.js';
import { computeS256Challenge } from '../src/pkce.js';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let orgId: string;
let userId: string;
let clientId: string;

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = computeS256Challenge(VERIFIER);

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);
  const orgRow = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  const userRow = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  orgId = orgRow[0]!.id;
  userId = userRow[0]!.id;
  clientId = `test_client_${Date.now()}`;
  await sql`
    INSERT INTO oauth_clients (organization_id, client_id, client_name, redirect_uris, scopes)
    VALUES (${orgId}, ${clientId}, 'codes-test', ARRAY['https://test/cb']::text[], ARRAY['search']::text[])
  `;
});

afterAll(async () => {
  await sql`DELETE FROM oauth_auth_codes WHERE client_id = ${clientId}`.catch(() => {});
  await sql`DELETE FROM oauth_clients WHERE client_id = ${clientId}`.catch(() => {});
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM oauth_auth_codes WHERE client_id = ${clientId}`;
});

function baseInput() {
  return {
    clientId,
    userId,
    organizationId: orgId,
    redirectUri: 'https://test/cb',
    scopes: ['search'],
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256' as const,
  };
}

describe('mintAuthCode + consumeAuthCode', () => {
  it('round-trips a code: mint then consume returns the bound user/org/scopes', async () => {
    const code = await mintAuthCode(db, baseInput());
    const result = await consumeAuthCode(db, {
      code,
      clientId,
      redirectUri: 'https://test/cb',
      codeVerifier: VERIFIER,
    });
    expect(result.userId).toBe(userId);
    expect(result.organizationId).toBe(orgId);
    expect(result.scopes).toEqual(['search']);
    expect(result.clientId).toBe(clientId);
  });

  it('rejects a reused code (one-shot)', async () => {
    const code = await mintAuthCode(db, baseInput());
    await consumeAuthCode(db, {
      code,
      clientId,
      redirectUri: 'https://test/cb',
      codeVerifier: VERIFIER,
    });
    await expect(
      consumeAuthCode(db, {
        code,
        clientId,
        redirectUri: 'https://test/cb',
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow(/HOLO_OAUTH_CODE_INVALID|already consumed|invalid/i);
  });

  it('rejects an unknown code', async () => {
    await expect(
      consumeAuthCode(db, {
        code: 'nonexistent-code',
        clientId,
        redirectUri: 'https://test/cb',
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow();
  });

  it('rejects a redirect_uri mismatch', async () => {
    const code = await mintAuthCode(db, baseInput());
    await expect(
      consumeAuthCode(db, {
        code,
        clientId,
        redirectUri: 'https://attacker/cb',
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow();
  });

  it('rejects a client_id mismatch', async () => {
    const code = await mintAuthCode(db, baseInput());
    await expect(
      consumeAuthCode(db, {
        code,
        clientId: 'different_client',
        redirectUri: 'https://test/cb',
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow();
  });

  it('rejects a PKCE verifier mismatch', async () => {
    const code = await mintAuthCode(db, baseInput());
    await expect(
      consumeAuthCode(db, {
        code,
        clientId,
        redirectUri: 'https://test/cb',
        codeVerifier: 'wrong-verifier-totally-not-the-right-one-at-all-43chr',
      }),
    ).rejects.toThrow();
  });

  it('rejects an expired code', async () => {
    const code = await mintAuthCode(db, baseInput());
    await sql`
      UPDATE oauth_auth_codes
         SET expires_at = now() - interval '1 minute'
       WHERE code = ${code}
    `;
    await expect(
      consumeAuthCode(db, {
        code,
        clientId,
        redirectUri: 'https://test/cb',
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow();
  });
});
