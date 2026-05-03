import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mountMcp } from '../src/mcp/transport.js';
import { HoloError } from '@holo/errors';
import type { McpSessionVars } from '../src/middleware/session.js';

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
