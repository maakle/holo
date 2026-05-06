import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, gt } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface MintAccessTokenInput {
  clientId: string;
  userId: string;
  organizationId: string;
  scopes: string[];
}

export interface MintedAccessToken {
  accessToken: string;
  expiresAt: Date;
}

export async function mintAccessToken(
  db: DB,
  input: MintAccessTokenInput,
): Promise<MintedAccessToken> {
  const accessToken = base64Url(randomBytes(32));
  const tokenHash = sha256Hex(accessToken);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

  await db.insert(schema.oauthAccessTokens).values({
    tokenHash,
    clientId: input.clientId,
    userId: input.userId,
    organizationId: input.organizationId,
    scopes: input.scopes,
    expiresAt,
  });

  return { accessToken, expiresAt };
}

export interface ValidatedToken {
  userId: string;
  organizationId: string;
  scopes: string[];
  clientId: string;
  clientName: string | null;
}

export async function validateAccessToken(
  db: DB,
  token: string,
): Promise<ValidatedToken | null> {
  const tokenHash = sha256Hex(token);
  const rows = await db
    .select({
      userId: schema.oauthAccessTokens.userId,
      organizationId: schema.oauthAccessTokens.organizationId,
      scopes: schema.oauthAccessTokens.scopes,
      clientId: schema.oauthAccessTokens.clientId,
      clientName: schema.oauthClients.clientName,
    })
    .from(schema.oauthAccessTokens)
    .leftJoin(
      schema.oauthClients,
      eq(schema.oauthClients.clientId, schema.oauthAccessTokens.clientId),
    )
    .where(
      and(
        eq(schema.oauthAccessTokens.tokenHash, tokenHash),
        isNull(schema.oauthAccessTokens.revokedAt),
        gt(schema.oauthAccessTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    scopes: row.scopes,
    clientId: row.clientId,
    clientName: row.clientName,
  };
}

export async function revokeAccessToken(db: DB, token: string): Promise<boolean> {
  const tokenHash = sha256Hex(token);
  const result = await db
    .update(schema.oauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.oauthAccessTokens.tokenHash, tokenHash),
        isNull(schema.oauthAccessTokens.revokedAt),
      ),
    )
    .returning({ id: schema.oauthAccessTokens.id });
  return result.length > 0;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
