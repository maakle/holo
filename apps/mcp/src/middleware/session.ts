import type { MiddlewareHandler } from 'hono';
import { validateSessionCookie } from '@holo/auth';
import type { DB } from '@holo/db';

export interface McpSessionVars {
  user: { userId: string; organizationId: string; email: string };
}

export function createSessionMiddleware(
  db: DB,
): MiddlewareHandler<{ Variables: McpSessionVars }> {
  return async (c, next) => {
    const cookie = c.req.header('cookie');
    const session = await validateSessionCookie(db, cookie);
    c.set('user', session);
    await next();
  };
}
