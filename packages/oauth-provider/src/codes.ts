import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { verifyPkce } from './pkce';
import type { CodeChallengeMethod } from './types';

const CODE_TTL_MS = 60_000;

export interface MintAuthCodeInput {
  clientId: string;
  userId: string;
  organizationId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: CodeChallengeMethod;
}

export async function mintAuthCode(db: DB, input: MintAuthCodeInput): Promise<string> {
  const code = base64Url(randomBytes(32));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db.insert(schema.oauthAuthCodes).values({
    code,
    clientId: input.clientId,
    userId: input.userId,
    organizationId: input.organizationId,
    redirectUri: input.redirectUri,
    scopes: input.scopes,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    expiresAt,
  });
  return code;
}

export interface ConsumeAuthCodeInput {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface ConsumeAuthCodeResult {
  userId: string;
  organizationId: string;
  scopes: string[];
  clientId: string;
}

export async function consumeAuthCode(
  db: DB,
  input: ConsumeAuthCodeInput,
): Promise<ConsumeAuthCodeResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.oauthAuthCodes)
      .where(eq(schema.oauthAuthCodes.code, input.code))
      .for('update');

    const row = rows[0];
    if (!row) throw invalid('Authorization code not found');
    if (row.consumedAt) throw invalid('Authorization code already consumed');
    if (row.expiresAt.getTime() <= Date.now()) throw invalid('Authorization code expired');
    if (row.redirectUri !== input.redirectUri) throw invalid('redirect_uri mismatch');
    if (row.clientId !== input.clientId) throw invalid('client_id mismatch');

    const pkceOk = verifyPkce(
      input.codeVerifier,
      row.codeChallenge,
      row.codeChallengeMethod as CodeChallengeMethod,
    );
    if (!pkceOk) throw invalid('PKCE verification failed');

    await tx
      .update(schema.oauthAuthCodes)
      .set({ consumedAt: new Date() })
      .where(eq(schema.oauthAuthCodes.id, row.id));

    return {
      userId: row.userId,
      organizationId: row.organizationId,
      scopes: row.scopes,
      clientId: row.clientId,
    };
  });
}

function invalid(detail: string): Error {
  return holoError({
    code: ErrorCode.HOLO_OAUTH_CODE_INVALID,
    problem: `OAuth authorization code is invalid: ${detail}`,
    fix: 'Restart the OAuth flow to obtain a fresh code.',
  });
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
