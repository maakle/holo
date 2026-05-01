import { createHash } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { eq, isNull, and } from 'drizzle-orm';
import { validateSessionCookie } from '@holo/auth';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';

export interface McpSessionVars {
  user: { userId: string; organizationId: string; email?: string };
}

export function createSessionMiddleware(
  db: DB,
): MiddlewareHandler<{ Variables: McpSessionVars }> {
  return async (c, next) => {
    // Check Bearer token first — takes precedence over cookie
    const authHeader = c.req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
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
          .catch(() => {
            // Ignore update errors — this is best-effort telemetry
          });

        c.set('user', {
          userId: row.userId,
          organizationId: row.organizationId,
          email: '',
        });
        await next();
        return;
      }
    }

    // Fall back to session cookie
    const cookie = c.req.header('cookie');
    const session = await validateSessionCookie(db, cookie);
    c.set('user', session);
    await next();
  };
}
