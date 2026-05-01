import { Hono, type Context, type Next } from 'hono';
import { type DB, schema } from '@holo/db';
import { HoloError } from '@holo/errors';
import { listTools, type ToolContext } from './tools/index.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export interface MountMcpOpts {
  db: DB;
  /** Resolves the request's organization context. */
  resolveContext(c: Context): Promise<ToolContext> | ToolContext;
  /** Optional middleware (e.g., session) applied before MCP handlers. */
  middleware?: (c: Context, next: Next) => Promise<void | Response>;
}

export function mountMcp(app: Hono, opts: MountMcpOpts): void {
  const handler = async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as JsonRpcRequest | null;
    if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return c.json(jsonRpcError(null, -32600, 'Invalid Request'), 400);
    }

    let ctx: ToolContext;
    try {
      ctx = await opts.resolveContext(c);
    } catch (err) {
      if (err instanceof HoloError) {
        return c.json(jsonRpcError(body.id, -32001, err.message, err.toJSON()), 401);
      }
      throw err;
    }

    try {
      switch (body.method) {
        case 'initialize':
          return c.json(
            jsonRpcResult(body.id, {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'holo-mcp', version: '0.0.0' },
            }),
          );
        case 'tools/list': {
          const tools = listTools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
          return c.json(jsonRpcResult(body.id, { tools }));
        }
        case 'tools/call': {
          const params = (body.params ?? {}) as { name?: string; arguments?: unknown };
          if (!params.name || typeof params.name !== 'string') {
            return c.json(
              jsonRpcError(body.id, -32602, 'Invalid params: name is required'),
              400,
            );
          }
          const tool = listTools().find((t) => t.name === params.name);
          if (!tool) {
            return c.json(
              jsonRpcError(body.id, -32601, `Unknown tool: ${params.name}`),
              404,
            );
          }
          const agentIdentity =
            c.req.header('x-agent-id') ?? c.req.header('user-agent') ?? null;
          const t0 = performance.now();
          const result = await tool.run(ctx, params.arguments);
          const latencyMs = Math.round(performance.now() - t0);
          console.log(
            JSON.stringify({
              event: 'mcp_tool_call',
              tool: params.name,
              org: ctx.organizationId,
              latency_ms: latencyMs,
              ts: new Date().toISOString(),
            }),
          );
          // Fire-and-forget invocation log
          ctx.db
            .insert(schema.mcpInvocations)
            .values({
              organizationId: ctx.organizationId,
              agentIdentity,
              toolName: params.name,
              inputJson: (params.arguments ?? {}) as Record<string, unknown>,
              outputJson: result as Record<string, unknown>,
              latencyMs,
            })
            .catch((err: unknown) =>
              console.error('Failed to log MCP invocation:', err),
            );
          return c.json(
            jsonRpcResult(body.id, {
              content: [{ type: 'text', text: JSON.stringify(result) }],
            }),
          );
        }
        default:
          return c.json(
            jsonRpcError(body.id, -32601, `Method not found: ${body.method}`),
            404,
          );
      }
    } catch (err) {
      if (err instanceof HoloError) {
        return c.json(jsonRpcError(body.id, -32000, err.message, err.toJSON()), 500);
      }
      console.error('MCP tool error:', err);
      const msg = err instanceof Error ? err.message : 'unknown error';
      return c.json(jsonRpcError(body.id, -32603, `Internal error: ${msg}`), 500);
    }
  };

  if (opts.middleware) {
    app.post('/mcp', opts.middleware, handler);
  } else {
    app.post('/mcp', handler);
  }
}
