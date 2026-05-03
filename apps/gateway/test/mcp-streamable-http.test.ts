import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { type McpSessionVars } from '../src/middleware/session.js';
import { mountMcp } from '../src/mcp/transport.js';
import { init, call } from './helpers/mcp-client.js';

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

  it('reuses session but reads the latest ctx on each request (no stale closure)', async () => {
    // Each call to resolveContext returns a different allowlist. The second
    // tools/call against the SAME session id must observe the new allowlist
    // — with the stale-closure bug the old ctx (which permitted `search`)
    // would still be in effect and the call would succeed.
    // For built-ins, an empty allowlist means "all allowed". To prove the
    // closure reads the latest ctx, the second allowlist must be NON-EMPTY
    // and exclude `search` (so checkToolAllowed actually rejects).
    const allowlists: string[][] = [
      ['search'],   // init request: doesn't matter
      ['search'],   // first tools/call: allowed
      ['get_pr'],   // second tools/call: search NOT in list ⇒ must reject
    ];
    let resolveCalls = 0;

    // Mock db where `.where(...)` is itself awaitable to `[]` (listCustomTools
    // awaits the where clause directly without .limit()).
    const dynDb = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      insert: () => ({ values: () => ({ catch: () => Promise.resolve() }) }),
    } as unknown as Parameters<typeof mountMcp>[1]['db'];

    const dynApp = new Hono<{ Variables: McpSessionVars }>();
    mountMcp(dynApp, {
      db: dynDb,
      middleware: async (c, next) => {
        c.set('user', { userId: 'u1', organizationId: 'o1', email: '' });
        await next();
      },
      async resolveContext() {
        const list = allowlists[Math.min(resolveCalls, allowlists.length - 1)]!;
        resolveCalls += 1;
        return {
          db: dynDb,
          organizationId: 'o1',
          userId: 'u1',
          userSubjects: ['org:o1'],
          activeToolAllowlist: list,
        };
      },
    });

    const sid = await init(dynApp);

    // Call #1: allowlist permits `search`. We don't care about the result
    // (the mock db will make the tool throw inside .run); we only need to
    // confirm the allowlist gate let it through.
    const first = (await call(dynApp, sid, 'tools/call', {
      name: 'search',
      arguments: { query: 'x' },
    })).body as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
      error?: { message?: string };
    };
    const firstMsg = first.error?.message ?? first.result?.content?.[0]?.text ?? '';
    expect(firstMsg).not.toMatch(/allowlist/i);

    // Call #2: allowlist is now empty. If the closure is stale, the gate
    // still sees ['search'] and lets the call through. With the fix, the
    // ctx ref is updated and the gate rejects.
    const second = (await call(dynApp, sid, 'tools/call', {
      name: 'search',
      arguments: { query: 'x' },
    })).body as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
      error?: { message?: string };
    };
    const secondMsg = second.error?.message ?? second.result?.content?.[0]?.text ?? '';
    expect(String(secondMsg)).toMatch(/allowlist/i);
  });
});
