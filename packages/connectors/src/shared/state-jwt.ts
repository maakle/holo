import { SignJWT, jwtVerify } from 'jose';
import { memexError, ErrorCode } from '@memex/errors';

export interface StateClaims {
  user_id: string;
  organization_id: string;
  csrf_nonce: string;
  provider: string;
}

const ALG = 'HS256';
const TTL_SECONDS = 600; // 10 min

export async function signState(claims: StateClaims, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyState(token: string, secret: string): Promise<StateClaims> {
  const key = new TextEncoder().encode(secret);
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
    return {
      user_id: String(payload['user_id']),
      organization_id: String(payload['organization_id']),
      csrf_nonce: String(payload['csrf_nonce']),
      provider: String(payload['provider']),
    };
  } catch (e) {
    throw memexError({
      code: ErrorCode.MEMEX_OAUTH_EXCHANGE_FAILED,
      problem: 'OAuth state JWT failed verification (invalid signature, malformed, or expired)',
      cause: (e as Error).message,
      fix: 'Restart the connect flow. State JWTs expire after 10 minutes.',
    });
  }
}
