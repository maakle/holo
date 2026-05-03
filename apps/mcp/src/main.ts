import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { createDb, schema } from '@holo/db';
import { HoloError } from '@holo/errors';
import { getSubjectsForUser } from '@holo/user-subjects';
import { createSessionMiddleware } from './middleware/session.js';
import { mountMcp } from './jsonrpc.js';
import { createRestRouter } from './rest/router.js';
import { openApiDoc } from './rest/openapi.js';

async function main() {
  const env = parseEnv(process.env);
  await initCrypto();
  const db = createDb(env.DATABASE_URL);

  const mcpPublicUrl = process.env.MCP_PUBLIC_URL ?? 'http://localhost:8080';
  const webPublicUrl =
    process.env.WEB_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HoloError) {
      const status =
        err.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : err.code === 'HOLO_CONNECTOR_NOT_IMPLEMENTED'
            ? 501
            : 500;
      return c.json(err.toJSON(), status);
    }
    console.error(err);
    return c.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
      500,
    );
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp' }));

  app.get('/_session-check', createSessionMiddleware(db), (c) =>
    c.json({ user: c.get('user' as never) }),
  );

  // OAuth 2.1 Authorization Server Metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: mcpPublicUrl,
      authorization_endpoint: `${webPublicUrl}/oauth/authorize`,
      token_endpoint: `${webPublicUrl}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    }),
  );

  // OAuth 2.1 Protected Resource Metadata (RFC 9728)
  app.get('/.well-known/oauth-protected-resource', (c) =>
    c.json({
      resource: mcpPublicUrl,
      authorization_servers: [webPublicUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['search', 'skills:read', 'skills:write'],
    }),
  );

  // OpenAPI spec (no auth)
  app.get('/openapi.json', (c) => c.json(openApiDoc));

  // REST API surface — /v1/health is public, all others require auth
  const sessionMiddleware = createSessionMiddleware(db);
  const restRouter = createRestRouter(db);

  // Mount public health endpoint without auth
  app.get('/v1/health', (c) => c.json({ status: 'ok', version: '0.1' }));

  // Mount authenticated REST routes
  app.use('/v1/skills', sessionMiddleware);
  app.use('/v1/skills/*', sessionMiddleware);
  app.use('/v1/search', sessionMiddleware);

  app.route('/', restRouter);

  mountMcp(app, {
    db,
    middleware: createSessionMiddleware(db),
    async resolveContext(c) {
      const user = c.get('user' as never) as
        | { organizationId: string; userId: string }
        | undefined;
      if (!user) {
        throw new HoloError({
          code: 'HOLO_AUTH_NO_SESSION',
          problem: 'no session attached to MCP request',
          fix: 'Authenticate via Better Auth and pass the session cookie or token.',
        });
      }

      // Optional: if caller passes x-active-skill-slug header, load that skill's toolAllowlist
      let activeToolAllowlist: string[] = [];
      const activeSkillSlug = c.req.header('x-active-skill-slug');
      if (activeSkillSlug) {
        const { eq, and } = await import('drizzle-orm');
        const skillRows = await db
          .select({ toolAllowlist: schema.skills.toolAllowlist })
          .from(schema.skills)
          .where(
            and(
              eq(schema.skills.organizationId, user.organizationId),
              eq(schema.skills.slug, activeSkillSlug),
              eq(schema.skills.status, 'active'),
            ),
          )
          .limit(1);
        activeToolAllowlist = skillRows[0]?.toolAllowlist ?? [];
      }

      const extraSubjects = await getSubjectsForUser(db, user.userId);
      return {
        db,
        organizationId: user.organizationId,
        userId: user.userId,
        userSubjects: [
          `org:${user.organizationId}`,
          `user:${user.userId}`,
          ...extraSubjects,
        ],
        activeToolAllowlist,
      };
    },
  });

  const port = Number(process.env.MCP_PORT ?? 8080);
  serve({ fetch: app.fetch, port });
  console.log(`apps/mcp listening on :${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
