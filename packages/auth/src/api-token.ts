import { createHash } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

const TOKEN_PREFIX = 'holo_';

export interface ApiTokenIdentity {
  userId: string;
  organizationId: string;
  tokenId: string;
}

/**
 * Validates a bearer token against the api_token table and bumps last_used_at.
 * Returns the workspace identity to attach to the request.
 *
 * Tokens are stored as SHA-256 hashes; this function hashes the candidate
 * once and looks up by hashed value (unique index on hashed_token).
 */
export async function validateBearerToken(
  db: DB,
  rawToken: string,
): Promise<ApiTokenIdentity> {
  if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'bearer token missing or malformed',
      fix: `Generate a token at /dashboard/connect-agent and pass it as 'Authorization: Bearer ${TOKEN_PREFIX}…'`,
    });
  }
  const hashedToken = createHash('sha256').update(rawToken).digest('hex');

  const rows = await db
    .select({
      tokenId: schema.apiToken.id,
      userId: schema.apiToken.userId,
      organizationId: schema.apiToken.organizationId,
    })
    .from(schema.apiToken)
    .where(
      and(
        eq(schema.apiToken.hashedToken, hashedToken),
        isNull(schema.apiToken.revokedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'bearer token not recognized or revoked',
      fix: 'Generate a fresh token at /dashboard/connect-agent.',
    });
  }

  // Best-effort touch; don't fail the request if it errors.
  void db
    .update(schema.apiToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiToken.id, row.tokenId))
    .catch(() => {});

  return row;
}

/** Extracts the token from an `Authorization: Bearer …` header value. */
export function readBearerHeader(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}
