import type { MiddlewareHandler } from 'hono';
import { validateSessionCookie } from '@memex/auth';
import type { DB } from '@memex/db';

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
