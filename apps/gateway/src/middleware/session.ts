import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { eq, isNull, and } from 'drizzle-orm';
import { validateSessionCookie } from '@holo/auth';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { validateAccessToken } from '@holo/oauth-provider';
import { logger } from '../logger.js';

export interface McpSessionVars {
  user: { userId: string; organizationId: string; email?: string };
}

export function createSessionMiddleware(
  db: DB,
): MiddlewareHandler<{ Variables: McpSessionVars }> {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();

      // 1) OAuth access token (v0.3+ canonical path)
      const oauth = await validateAccessToken(db, token);
      if (oauth) {
        c.set('user', {
          userId: oauth.userId,
          organizationId: oauth.organizationId,
          email: '',
        });
        await next();
        return;
      }

      // 2) v0.1 REST API token (legacy)
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const rows = await db
        .select({
          userId: schema.apiTokens.userId,
          organizationId: schema.apiTokens.organizationId,
        })
        .from(schema.apiTokens)
        .where(
          and(
            eq(schema.apiTokens.tokenHash, tokenHash),
            isNull(schema.apiTokens.revokedAt),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row) {
        // Fire-and-forget lastUsedAt update
        db.update(schema.apiTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiTokens.tokenHash, tokenHash))
          .catch((err) => logger.warn({ err }, 'lastUsedAt update failed'));
        c.set('user', {
          userId: row.userId,
          organizationId: row.organizationId,
          email: '',
        });
        await next();
        return;
      }
    }

    // 3) Session cookie (first-party web)
    const cookie = c.req.header('cookie');
    const session = await validateSessionCookie(db, cookie);
    c.set('user', session);
    await next();
  };
}
