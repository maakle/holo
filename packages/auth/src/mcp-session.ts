import { eq, and, gt } from 'drizzle-orm';
import type { DB } from '@memex/db';
import { schema } from '@memex/db';
import { memexError, ErrorCode } from '@memex/errors';

export interface SessionUser {
  userId: string;
  organizationId: string;
  email: string;
}

const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';').map((p) => p.trim());
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const name = part.slice(0, eqIdx);
    if (SESSION_COOKIE_NAMES.includes(name)) {
      return decodeURIComponent(part.slice(eqIdx + 1));
    }
  }
  return null;
}

export async function validateSessionCookie(
  db: DB,
  cookieHeader: string | undefined,
): Promise<SessionUser> {
  const tokenCandidate = readSessionCookie(cookieHeader);
  if (!tokenCandidate) {
    throw memexError({
      code: ErrorCode.MEMEX_AUTH_NO_SESSION,
      problem: 'no Better Auth session cookie on request',
      fix: 'Sign in at the dashboard URL. For agents, see docs/auth.md.',
    });
  }
  const token = tokenCandidate.split('.')[0]!;

  const rows = await db
    .select({
      userId: schema.session.userId,
      email: schema.user.email,
      organizationId: schema.user.organizationId,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(and(eq(schema.session.token, token), gt(schema.session.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw memexError({
      code: ErrorCode.MEMEX_AUTH_NO_SESSION,
      problem: 'session cookie present but not valid (expired or unknown)',
      fix: 'Sign in again at the dashboard URL.',
    });
  }
  return row;
}
