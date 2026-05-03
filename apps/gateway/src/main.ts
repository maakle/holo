import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { createDb, schema } from '@holo/db';
import { HoloError } from '@holo/errors';
import { getSubjectsForUser } from '@holo/user-subjects';
import { createSessionMiddleware, type McpSessionVars } from './middleware/session.js';
import { mountMcp } from './mcp/transport.js';
import { apiReference } from '@scalar/hono-api-reference';
import { createRestRouter, openApiConfig } from './rest/router.js';
import { logger } from './logger.js';

async function main() {
  const env = parseEnv(process.env);
  await initCrypto();
  const db = createDb(env.DATABASE_URL);

  const mcpPublicUrl = env.MCP_PUBLIC_URL;
  const webPublicUrl = env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL;

  const app = new Hono<{ Variables: McpSessionVars }>();

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
    logger.error({ err }, 'unhandled gateway error');
    return c.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
      500,
    );
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'mcp' }));

  app.get('/_session-check', createSessionMiddleware(db), (c) =>
    c.json({ user: c.get('user') }),
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

  // REST API surface — /v1/health is public, all others require auth.
  // Routes + their schemas live in ./rest/router.ts (zod-openapi).
  const sessionMiddleware = createSessionMiddleware(db);
  const restRouter = createRestRouter(db);

  // Auth middleware applies to authenticated REST paths only — NOT /v1/health.
  app.use('/v1/skills', sessionMiddleware);
  app.use('/v1/skills/*', sessionMiddleware);
  app.use('/v1/search', sessionMiddleware);

  // Expose the auto-generated OpenAPI document and a Scalar-rendered docs UI.
  // Both are public (no auth) so OSS users can introspect the API surface.
  restRouter.doc('/openapi.json', openApiConfig);
  app.get('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));

  app.route('/', restRouter);

  mountMcp(app, {
    db,
    middleware: createSessionMiddleware(db),
    async resolveContext(c) {
      const user = c.get('user');
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
        anthropicApiKey: env.ANTHROPIC_API_KEY,
      };
    },
  });

  const port = env.MCP_PORT;
  serve({ fetch: app.fetch, port });
  logger.info({ port }, 'gateway listening');
}

main().catch((e) => {
  logger.fatal({ err: e }, 'gateway boot failed');
  process.exit(1);
});
