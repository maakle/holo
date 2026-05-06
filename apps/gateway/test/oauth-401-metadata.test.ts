import { it, expect } from 'vitest';
import { Hono } from 'hono';
import { mountMcp } from '../src/mcp/transport.js';
import { HoloError } from '@holo/errors';
import type { McpSessionVars } from '../src/middleware/session.js';
import { logger } from '../src/logger.js';

it('401 on /mcp includes WWW-Authenticate with resource_metadata', async () => {
  const app = new Hono<{ Variables: McpSessionVars }>();
  mountMcp(app, {
    db: {} as never,
    async resolveContext() {
      throw new HoloError({
        code: 'HOLO_AUTH_NO_SESSION',
        problem: 'no session',
        fix: 'authenticate',
      });
    },
  });
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  expect(res.status).toBe(401);
  const wwwAuth = res.headers.get('www-authenticate');
  expect(wwwAuth).toMatch(/^Bearer\s+resource_metadata="/);
  expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
});

// Regression: the global app.onError swallowed errors thrown from middleware
// (before mountMcp's resolveContext ran), which dropped the WWW-Authenticate
// header — leaving Claude/Cursor with no way to discover the OAuth server.
it('401 from middleware (not resolveContext) still includes WWW-Authenticate', async () => {
  const app = new Hono<{ Variables: McpSessionVars }>();

  // Replicate main.ts global error handler.
  app.onError((err, c) => {
    if (err instanceof HoloError) {
      const status = err.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 500;
      if (status === 401 && new URL(c.req.url).pathname === '/mcp') {
        const prmUrl = new URL(
          '/.well-known/oauth-protected-resource',
          c.req.url,
        ).toString();
        return c.json(err.toJSON(), 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${prmUrl}"`,
        });
      }
      return c.json(err.toJSON(), status);
    }
    logger.error({ err }, 'unhandled');
    return c.json({ code: 'HOLO_INTERNAL', problem: 'x', fix: 'y' }, 500);
  });

  // Middleware that throws like the real session middleware does.
  mountMcp(app, {
    db: {} as never,
    middleware: async () => {
      throw new HoloError({
        code: 'HOLO_AUTH_NO_SESSION',
        problem: 'no session',
        fix: 'authenticate',
      });
    },
    async resolveContext() {
      throw new Error('should not reach resolveContext');
    },
  });

  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  expect(res.status).toBe(401);
  const wwwAuth = res.headers.get('www-authenticate');
  expect(wwwAuth).toMatch(/^Bearer\s+resource_metadata="/);
  expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
});
