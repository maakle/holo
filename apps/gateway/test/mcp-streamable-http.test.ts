import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { type McpSessionVars } from '../src/middleware/session.js';
import { mountMcp } from '../src/mcp/transport.js';

const db = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert: () => ({ values: () => ({ catch: () => Promise.resolve() }) }),
} as unknown as Parameters<typeof mountMcp>[1]['db'];

let app: Hono<{ Variables: McpSessionVars }>;

beforeAll(() => {
  app = new Hono<{ Variables: McpSessionVars }>();
  mountMcp(app, {
    db,
    middleware: async (c, next) => {
      c.set('user', { userId: 'u1', organizationId: 'o1', email: '' });
      await next();
    },
    async resolveContext() {
      return { db, organizationId: 'o1', userId: 'u1', userSubjects: ['org:o1'] };
    },
  });
});

describe('MCP streamable HTTP transport', () => {
  it('responds to initialize and returns Mcp-Session-Id', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('rejects POST without proper accept header on non-initialize', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    });
    expect([400, 406]).toContain(res.status);
  });

  it('does not respond to JSON-RPC notifications (no id)', async () => {
    const init = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    });
    const sid = init.headers.get('mcp-session-id')!;

    const res = await app.request('/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBe(202);
  });
});
