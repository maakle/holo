import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { createDb, type DB } from '@holo/db';
import { HoloError } from '@holo/errors';
import { createAuthMiddleware, type RequestIdentity } from './middleware/auth';
import { TOOLS, callSearchTool } from './tools';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2024-11-05';

async function handleJsonRpc(
  db: DB,
  identity: RequestIdentity,
  body: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = body.id ?? null;
  try {
    switch (body.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'holo', version: '0.0.0' },
          },
        };

      case 'notifications/initialized':
        // Notifications have no response.
        return null;

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

      case 'tools/call': {
        const params = body.params ?? {};
        const name = params['name'] as string | undefined;
        const args = params['arguments'];
        if (name === 'search') {
          const result = await callSearchTool(db, identity.organizationId, args);
          return { jsonrpc: '2.0', id, result };
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `unknown tool: ${name}` },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `method not found: ${body.method}` },
        };
    }
  } catch (err) {
    if (err instanceof HoloError) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.problem, data: err.toJSON() },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: (err as Error).message ?? 'internal error' },
    };
  }
}

async function main() {
  const env = parseEnv(process.env);
  await initCrypto();
  const db = createDb(env.DATABASE_URL);

  const app = new Hono<{ Variables: { identity: RequestIdentity } }>();

  app.onError((err, c) => {
    if (err instanceof HoloError) {
      const status =
        err.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : err.code === 'HOLO_VALIDATION'
            ? 400
            : err.code === 'HOLO_AUTH_FORBIDDEN'
              ? 403
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

  // Single-message JSON-RPC over HTTP. Streamable-HTTP transport (server-sent events
  // + multi-message sessions) lands when we ship long-running tools.
  app.post('/mcp', createAuthMiddleware(db), async (c) => {
    const identity = c.get('identity');
    const body = (await c.req.json()) as JsonRpcRequest | JsonRpcRequest[];
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((r) => handleJsonRpc(db, identity, r)));
      return c.json(responses.filter((r): r is JsonRpcResponse => r !== null));
    }
    const response = await handleJsonRpc(db, identity, body);
    if (response === null) return c.body(null, 204);
    return c.json(response);
  });

  const port = Number(process.env.MCP_PORT ?? 8091);
  serve({ fetch: app.fetch, port });
  console.log(`apps/mcp listening on :${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
