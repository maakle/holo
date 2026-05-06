import { randomUUID } from 'node:crypto';
import type { Hono, Context, Next } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DB } from '@holo/db';
import { HoloError, holoError, ErrorCode } from '@holo/errors';
import { recordAgentEvent } from '@holo/audit';
import type { AgentEventKind } from '@holo/db';
import { listTools, type ToolContext } from './registry.js';
import { checkToolAllowed } from '../middleware/allowlist.js';
import type { McpSessionVars } from '../middleware/session.js';
import { logger } from '../logger.js';

function logEvent(
  ctx: ToolContext,
  args: {
    kind: AgentEventKind;
    name: string;
    inputJson?: Record<string, unknown>;
    outputJson?: Record<string, unknown> | null;
    errorCode?: string | null;
    latencyMs: number;
    metadata?: Record<string, unknown>;
  },
): void {
  recordAgentEvent(
    {
      db: ctx.db,
      organizationId: ctx.organizationId,
      agentIdentity: ctx.agentIdentity,
      traceId: ctx.traceId,
      ...args,
    },
    (err) => logger.error({ err }, 'agent event log failed'),
  );
}

export interface MountMcpOpts {
  db: DB;
  resolveContext(c: Context<{ Variables: McpSessionVars }>): Promise<ToolContext> | ToolContext;
  middleware?: (
    c: Context<{ Variables: McpSessionVars }>,
    next: Next,
  ) => Promise<void | Response>;
}

const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  ctxRef: { current: ToolContext };
  lastUsed: number;
}

const sessions = new Map<string, SessionEntry>();

function buildServer(getCtx: () => ToolContext): Server {
  const server = new Server(
    { name: 'holo-mcp', version: '0.1.0' },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const ctx = getCtx();
    const t0 = performance.now();
    let errorCode: string | null = null;
    let tools: Awaited<ReturnType<typeof listTools>> = [];
    try {
      tools = await listTools(ctx);
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    } catch (err) {
      errorCode = err instanceof HoloError ? err.code : 'INTERNAL';
      throw err;
    } finally {
      const latencyMs = Math.round(performance.now() - t0);
      logEvent(ctx, {
        kind: 'mcp_list',
        name: '__list_tools__',
        outputJson: errorCode ? null : { count: tools.length },
        errorCode,
        latencyMs,
      });
    }
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const ctx = getCtx();
    const t0 = performance.now();
    const inputJson = (req.params.arguments ?? {}) as Record<string, unknown>;
    const logFailure = (err: unknown): never => {
      const latencyMs = Math.round(performance.now() - t0);
      const errorCode = err instanceof HoloError ? err.code : 'INTERNAL';
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          event: 'mcp_tool_call_failed',
          tool: req.params.name,
          org: ctx.organizationId,
          agent: ctx.agentIdentity ?? null,
          errorCode,
          latencyMs,
        },
        'mcp tool call failed',
      );
      logEvent(ctx, {
        kind: 'mcp_call',
        name: req.params.name,
        inputJson,
        outputJson: { error: errorMessage },
        errorCode,
        latencyMs,
      });
      throw err;
    };

    let all: Awaited<ReturnType<typeof listTools>>;
    try {
      all = await listTools(ctx);
    } catch (err) {
      return logFailure(err);
    }
    const tool = all.find((t) => t.name === req.params.name);
    if (!tool) {
      return logFailure(
        holoError({
          code: ErrorCode.HOLO_NOT_FOUND,
          problem: `Unknown tool: ${req.params.name}`,
          fix: 'Call tools/list to see available tools.',
        }),
      );
    }

    const customNames = new Set(all.filter((t) => t.isCustom).map((t) => t.name));
    if (
      !checkToolAllowed(req.params.name, ctx.activeToolAllowlist ?? [], {
        customToolNames: customNames,
      })
    ) {
      return logFailure(
        holoError({
          code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
          problem: `Tool '${req.params.name}' not in active skill allowlist`,
          fix: 'Add the tool to the active skill\'s toolAllowlist, or activate a different skill.',
        }),
      );
    }

    try {
      const result = await tool.run(ctx, req.params.arguments);
      const latencyMs = Math.round(performance.now() - t0);
      logger.info(
        {
          event: 'mcp_tool_call',
          tool: req.params.name,
          org: ctx.organizationId,
          agent: ctx.agentIdentity ?? null,
          latencyMs,
        },
        'mcp tool call',
      );
      logEvent(ctx, {
        kind: 'mcp_call',
        name: req.params.name,
        inputJson,
        outputJson: result as Record<string, unknown>,
        latencyMs,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return logFailure(err);
    }
  });

  return server;
}

export function mountMcp(app: Hono<{ Variables: McpSessionVars }>, opts: MountMcpOpts): void {
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
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    // Inline idle sweep — drop sessions that haven't been touched recently.
    const now = Date.now();
    for (const [sid, entry] of sessions) {
      if (now - entry.lastUsed > SESSION_IDLE_MS) {
        entry.transport.close().catch(() => {});
        sessions.delete(sid);
      }
    }

    let transport: WebStandardStreamableHTTPServerTransport;
    if (existing) {
      // Refresh the per-session ctx so the buildServer closure sees the
      // latest allowlist / user / etc. on every request.
      existing.ctxRef.current = ctx;
      existing.lastUsed = now;
      transport = existing.transport;
    } else {
      const ctxRef = { current: ctx };
      const created = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, { transport: created, ctxRef, lastUsed: Date.now() });
        },
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
      };
      const server = buildServer(() => ctxRef.current);
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
