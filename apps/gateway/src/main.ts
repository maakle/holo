import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { createDb } from '@holo/db';
import { HoloError } from '@holo/errors';
import { getSubjectsForUser } from '@holo/user-subjects';
import { createSessionMiddleware, type McpSessionVars } from './middleware/session.js';
import { resolveActiveToolAllowlist } from './middleware/allowlist.js';
import { mountMcp } from './mcp/transport.js';
import { apiReference } from '@scalar/hono-api-reference';
import { createRestRouter, openApiConfig } from './rest/router.js';
import { mountSlackEvents } from './slack/events.js';
import { mountSlackCommands } from './slack/commands.js';
import { mountSlackInteractivity } from './slack/interactivity.js';
import { mountGoogleChatAppEvents } from './google-chat-app/events.js';
import { mountGoogleChatAppHealthz } from './google-chat-app/healthz.js';
import { mountTeamsBotMessages } from './teams-bot/messages.js';
import { mountTeamsBotHealthz } from './teams-bot/healthz.js';
import { logger } from './logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      // RFC 9728: a 401 from /mcp must point clients at the protected-resource
      // metadata so MCP clients (Claude, Cursor) can discover the OAuth
      // authorization server and start the OAuth flow. Use MCP_PUBLIC_URL —
      // c.req.url reflects the origin's inner scheme (http behind Cloudflare's
      // TLS termination), which would send clients to a broken URL.
      if (
        status === 401 &&
        new URL(c.req.url).pathname === '/mcp'
      ) {
        const prmUrl = new URL(
          '/.well-known/oauth-protected-resource',
          mcpPublicUrl,
        ).toString();
        return c.json(err.toJSON(), 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${prmUrl}"`,
        });
      }
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

  // OAuth 2.1 Authorization Server Metadata (RFC 8414).
  // Note: the protected-resource metadata below points clients at the
  // dashboard as the authorization server, so this gateway-served copy is for
  // discovery clients that probe the resource origin directly. Endpoint paths
  // must match what the dashboard actually implements.
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json({
      issuer: mcpPublicUrl,
      authorization_endpoint: `${webPublicUrl}/oauth/authorize`,
      token_endpoint: `${webPublicUrl}/api/oauth/token`,
      registration_endpoint: `${webPublicUrl}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['search', 'skills:read', 'skills:write'],
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
  app.use('/v1/feedback', sessionMiddleware);

  // Expose the auto-generated OpenAPI document and a Scalar-rendered docs UI.
  // Both are public (no auth) so OSS users can introspect the API surface.
  restRouter.doc('/openapi.json', openApiConfig);
  app.get('/docs', apiReference({ url: '/openapi.json', theme: 'default' }));

  app.route('/', restRouter);

  // Slack bot endpoints — public (Slack signs requests; verification is in
  // the handlers). Mounted before MCP so Slack's POSTs aren't accidentally
  // routed through the MCP middleware stack.
  mountSlackEvents(app, {
    db,
    signingSecret: env.SLACK_CONNECTOR_SIGNING_SECRET,
    redisUrl: env.REDIS_URL,
  });
  mountSlackCommands(app, {
    db,
    signingSecret: env.SLACK_CONNECTOR_SIGNING_SECRET,
    redisUrl: env.REDIS_URL,
  });
  mountSlackInteractivity(app, {
    db,
    signingSecret: env.SLACK_CONNECTOR_SIGNING_SECRET,
  });

  // Google Chat App webhook — public (Google signs requests with a JWT
  // bearer; verification is in the handler). Same placement as Slack:
  // mounted before MCP so Chat's POSTs aren't accidentally routed through
  // the MCP middleware stack.
  mountGoogleChatAppEvents(app, {
    db,
    sharedAudience: env.GOOGLE_CHAT_APP_PROJECT_NUMBER,
    redisUrl: env.REDIS_URL,
    webPublicUrl,
  });
  mountGoogleChatAppHealthz(app, {
    audience: env.GOOGLE_CHAT_APP_PROJECT_NUMBER,
    serviceAccountJson: env.GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON,
  });

  // Microsoft Teams bot endpoint — public (Bot Framework signs requests
  // with a JWT; verification is in the handler). Mounted before MCP for
  // the same reason as Slack: this is third-party-originated traffic
  // that has its own auth contract.
  mountTeamsBotMessages(app, {
    db,
    sharedAppId: env.TEAMS_BOT_APP_ID,
    redisUrl: env.REDIS_URL,
  });
  mountTeamsBotHealthz(app, {
    appId: env.TEAMS_BOT_APP_ID,
    appSecret: env.TEAMS_BOT_APP_SECRET,
  });

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

      const activeToolAllowlist = await resolveActiveToolAllowlist(
        db,
        user.organizationId,
        c.req.header('x-active-skill-slug'),
      );

      const extraSubjects = await getSubjectsForUser(db, user.userId);
      const sessionId = c.req.header('mcp-session-id');
      const traceId = sessionId && UUID_RE.test(sessionId) ? sessionId : undefined;
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
        agentIdentity: user.agentIdentity,
        traceId,
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
