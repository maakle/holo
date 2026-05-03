import { eq, and, gt } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface SessionUser {
  userId: string;
  /**
   * The org the request is scoped to. This is the session's
   * `activeOrganizationId` if set (and the user is a verified member),
   * otherwise the user's home org (`user.organization_id`).
   */
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
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'no Better Auth session cookie on request',
      fix: 'Sign in at the dashboard URL. For agents, see docs/auth.md.',
    });
  }
  const token = tokenCandidate.split('.')[0]!;

  const rows = await db
    .select({
      userId: schema.session.userId,
      email: schema.user.email,
      homeOrganizationId: schema.user.organizationId,
      activeOrganizationId: schema.session.activeOrganizationId,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
    .where(and(eq(schema.session.token, token), gt(schema.session.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'session cookie present but not valid (expired or unknown)',
      fix: 'Sign in again at the dashboard URL.',
    });
  }

  // Prefer the session's active org, but only after confirming the user is
  // still a member. A stale activeOrganizationId (e.g. removed from the org)
  // must not grant access — fall back to the home org.
  let organizationId = row.homeOrganizationId;
  if (row.activeOrganizationId && row.activeOrganizationId !== row.homeOrganizationId) {
    const memberRows = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.userId, row.userId),
          eq(schema.member.organizationId, row.activeOrganizationId),
        ),
      )
      .limit(1);
    if (memberRows[0]) {
      organizationId = row.activeOrganizationId;
    }
  }

  return { userId: row.userId, email: row.email, organizationId };
}
