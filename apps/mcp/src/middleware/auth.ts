import type { MiddlewareHandler } from 'hono';
import { readBearerHeader, validateBearerToken, validateSessionCookie } from '@holo/auth';
import type { DB } from '@holo/db';

export interface RequestIdentity {
  userId: string;
  organizationId: string;
  source: 'bearer' | 'cookie';
  email?: string;
  tokenId?: string;
}

/**
 * Tries `Authorization: Bearer holo_…` first (for agents), then falls back to
 * the Better Auth session cookie (for browser-based smoke testing). Both routes
 * resolve to the same shape: a userId + organizationId we can scope queries to.
 */
export function createAuthMiddleware(
  db: DB,
): MiddlewareHandler<{ Variables: { identity: RequestIdentity } }> {
  return async (c, next) => {
    const bearer = readBearerHeader(c.req.header('authorization'));
    if (bearer) {
      const id = await validateBearerToken(db, bearer);
      c.set('identity', {
        userId: id.userId,
        organizationId: id.organizationId,
        source: 'bearer',
        tokenId: id.tokenId,
      });
      await next();
      return;
    }
    const cookie = c.req.header('cookie');
    const session = await validateSessionCookie(db, cookie);
    c.set('identity', {
      userId: session.userId,
      organizationId: session.organizationId,
      source: 'cookie',
      email: session.email,
    });
    await next();
  };
}
