import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { Hono } from 'hono';
import { createDb } from '@holo/db';
import { HoloError } from '@holo/errors';
import {
  mintAuthCode,
  consumeAuthCode,
  mintAccessToken,
  revokeAccessToken,
  computeS256Challenge,
} from '@holo/oauth-provider';
import { mountMcp } from '../src/mcp/transport.js';
import { init, call } from './helpers/mcp-client.js';
import { createSessionMiddleware } from '../src/middleware/session.js';
import type { ToolContext } from '../src/tools/index.js';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = computeS256Challenge(VERIFIER);
const REDIRECT_URI = 'https://test/cb';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let app: Hono;
let orgId: string;
let userId: string;
let clientId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);

  const orgRows = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  if (!orgRows[0]) throw new Error('No organization seeded — run db migrations/seed first');
  orgId = orgRows[0].id;

  // Make sure we have at least one user in this org for the OAuth subject
  const userRows = await sql<{ id: string }[]>`
    SELECT id FROM "user" WHERE organization_id = ${orgId} LIMIT 1
  `;
  if (userRows[0]) {
    userId = userRows[0].id;
  } else {
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO "user" (email, organization_id)
      VALUES (${`oauth-roundtrip-${Date.now()}@test.local`}, ${orgId})
      RETURNING id
    `;
    userId = inserted[0]!.id;
  }

  clientId = `roundtrip_client_${Date.now()}`;
  await sql`
    INSERT INTO oauth_clients (organization_id, client_id, client_name, redirect_uris, scopes)
    VALUES (${orgId}, ${clientId}, 'roundtrip-test', ARRAY[${REDIRECT_URI}]::text[], ARRAY['search']::text[])
  `;

  app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HoloError) return c.json(err.toJSON(), 401);
    return c.json({ error: String(err) }, 500);
  });

  const sessionMw = createSessionMiddleware(db);
  mountMcp(app, {
    db,
    middleware: sessionMw,
    async resolveContext(c) {
      const user = c.get('user' as never) as
        | { userId: string; organizationId: string }
        | undefined;
      if (!user) {
        throw new HoloError({
          code: 'HOLO_AUTH_NO_SESSION',
          problem: 'no user on context',
          fix: 'Authenticate first',
        });
      }
      const ctx: ToolContext = {
        db,
        organizationId: user.organizationId,
        userSubjects: [`org:${user.organizationId}`, `user:${user.userId}`],
        activeToolAllowlist: [],
      };
      return ctx;
    },
  });
});

afterAll(async () => {
  await sql`DELETE FROM oauth_access_tokens WHERE client_id = ${clientId}`.catch(() => {});
  await sql`DELETE FROM oauth_auth_codes WHERE client_id = ${clientId}`.catch(() => {});
  await sql`DELETE FROM oauth_clients WHERE client_id = ${clientId}`.catch(() => {});
  await sql.end();
});

async function fullFlow(): Promise<string> {
  const code = await mintAuthCode(db, {
    clientId,
    userId,
    organizationId: orgId,
    redirectUri: REDIRECT_URI,
    scopes: ['search'],
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
  });
  const consumed = await consumeAuthCode(db, {
    code,
    clientId,
    redirectUri: REDIRECT_URI,
    codeVerifier: VERIFIER,
  });
  const { accessToken } = await mintAccessToken(db, {
    clientId: consumed.clientId,
    userId: consumed.userId,
    organizationId: consumed.organizationId,
    scopes: consumed.scopes,
  });
  return accessToken;
}

/** Initialize an MCP session over the new Streamable HTTP transport. */
async function initSession(token: string | null): Promise<{ status: number; sessionId: string | null }> {
  try {
    const sid = await init(app, { token: token ?? undefined });
    return { status: 200, sessionId: sid };
  } catch (err) {
    // init() throws "init failed: <status> <body>" on non-200 — recover the status.
    const m = /^init failed: (\d+)/.exec(String((err as Error).message));
    return { status: m ? Number(m[1]) : 500, sessionId: null };
  }
}

async function callMethod(
  token: string | null,
  sessionId: string,
  method: string,
  params: unknown,
): Promise<{ status: number; body: unknown }> {
  return call(app, sessionId, method, params, { token: token ?? undefined });
}

describe('oauth roundtrip', () => {
  it('full flow: code → token → MCP tools/list returns built-ins', async () => {
    const token = await fullFlow();
    const { sessionId } = await initSession(token);
    expect(sessionId).toBeTruthy();
    const { status, body } = await callMethod(token, sessionId!, 'tools/list', {});
    expect(status).toBe(200);
    const result = (body as { result: { tools: Array<{ name: string }> } }).result;
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('search');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it('token validates against MCP — search tool is listed', async () => {
    const token = await fullFlow();
    const { sessionId } = await initSession(token);
    expect(sessionId).toBeTruthy();
    const { status, body } = await callMethod(token, sessionId!, 'tools/list', {});
    expect(status).toBe(200);
    const result = (body as { result: { tools: Array<{ name: string }> } }).result;
    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools.map((t) => t.name)).toContain('search');
  });

  it('reused code is rejected', async () => {
    const code = await mintAuthCode(db, {
      clientId,
      userId,
      organizationId: orgId,
      redirectUri: REDIRECT_URI,
      scopes: ['search'],
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    });
    await consumeAuthCode(db, {
      code,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
    });
    await expect(
      consumeAuthCode(db, {
        code,
        clientId,
        redirectUri: REDIRECT_URI,
        codeVerifier: VERIFIER,
      }),
    ).rejects.toThrow();
  });

  it('unknown bearer token is rejected by MCP (initialize fails)', async () => {
    const { status } = await initSession('totally-not-a-real-token');
    expect(status).not.toBe(200);
  });

  it('revoked bearer token is rejected by MCP (initialize fails)', async () => {
    const token = await fullFlow();
    const ok = await revokeAccessToken(db, token);
    expect(ok).toBe(true);
    const { status } = await initSession(token);
    expect(status).not.toBe(200);
  });
});
