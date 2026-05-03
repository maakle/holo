import { randomUUID } from 'node:crypto';
import type { Hono, Context, Next } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { HoloError } from '@holo/errors';
import { listTools, type ToolContext } from './registry.js';
import { checkToolAllowed } from '../middleware/allowlist.js';

export interface MountMcpOpts {
  db: DB;
  resolveContext(c: Context): Promise<ToolContext> | ToolContext;
  middleware?: (c: Context, next: Next) => Promise<void | Response>;
}

const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

function buildServer(getCtx: () => ToolContext): Server {
  const server = new Server(
    { name: 'holo-mcp', version: '0.1.0' },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await listTools(getCtx());
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const ctx = getCtx();
    const all = await listTools(ctx);
    const tool = all.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);

    const customNames = new Set(all.filter((t) => t.isCustom).map((t) => t.name));
    if (
      !checkToolAllowed(req.params.name, ctx.activeToolAllowlist ?? [], {
        customToolNames: customNames,
      })
    ) {
      throw new Error(`Tool '${req.params.name}' not in active skill allowlist`);
    }

    const t0 = performance.now();
    const result = await tool.run(ctx, req.params.arguments);
    const latencyMs = Math.round(performance.now() - t0);
    console.log(
      JSON.stringify({
        event: 'mcp_tool_call',
        tool: req.params.name,
        org: ctx.organizationId,
        latency_ms: latencyMs,
        ts: new Date().toISOString(),
      }),
    );

    ctx.db
      .insert(schema.mcpInvocations)
      .values({
        organizationId: ctx.organizationId,
        agentIdentity: null,
        toolName: req.params.name,
        inputJson: (req.params.arguments ?? {}) as Record<string, unknown>,
        outputJson: result as Record<string, unknown>,
        latencyMs,
      })
      .catch((err: unknown) => console.error('Failed to log MCP invocation:', err));

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });

  return server;
}

export function mountMcp(app: Hono, opts: MountMcpOpts): void {
  const handler = async (c: Context) => {
    let ctx: ToolContext;
    try {
      ctx = await opts.resolveContext(c);
    } catch (err) {
      if (err instanceof HoloError) {
        const prmUrl = new URL('/.well-known/oauth-protected-resource', c.req.url).toString();
        return c.json(err.toJSON(), 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${prmUrl}"`,
        });
      }
      throw err;
    }

    const sessionId = c.req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      const created = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, created);
        },
      });
      created.onclose = () => {
        if (created.sessionId) transports.delete(created.sessionId);
      };
      const server = buildServer(() => ctx);
      await server.connect(created);
      transport = created;
    }

    return transport.handleRequest(c.req.raw);
  };

  if (opts.middleware) {
    app.all('/mcp', opts.middleware, handler);
  } else {
    app.all('/mcp', handler);
  }
}
