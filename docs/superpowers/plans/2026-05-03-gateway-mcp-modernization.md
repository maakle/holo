# Gateway MCP Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `apps/gateway` up to MCP spec 2025-06-18 (Streamable HTTP transport, session IDs, OAuth 401 metadata advertisement, resource-indicator audience check) and clean up four code-quality drags identified in the 2026-05-03 review.

**Architecture:** Replace the hand-rolled JSON-RPC handler in `src/jsonrpc.ts` with the official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`, mounted on Hono via a single `app.all('/mcp', …)` route that proxies `c.req.raw` / `c.res` to the transport. Tools become an array-driven registry instead of nine copy-pasted blocks. Logging consolidates on pino. Hono `Variables` are typed properly so `c.get('user')` is type-safe everywhere. Env access goes through `@holo/env`.

**Tech Stack:** Hono 4.6, `@modelcontextprotocol/sdk` (new dep), pino 9.5, Zod 4.4, Vitest 2.1, drizzle-orm 0.45, TypeScript 5.6.

---

## File Structure

**Create:**
- `apps/gateway/src/mcp/transport.ts` — `createMcpServer(opts)` returns an SDK `McpServer` wired to the tool registry; mounting helper that adapts SDK `StreamableHTTPServerTransport` to Hono.
- `apps/gateway/src/mcp/registry.ts` — single `BUILTIN_TOOLS` array + `buildToolList(ctx)` that merges built-ins with custom tools.
- `apps/gateway/src/logger.ts` — single pino instance exported as `logger`.
- `apps/gateway/test/mcp-streamable-http.test.ts` — initialize → tools/list → tools/call over the SDK transport.
- `apps/gateway/test/oauth-401-metadata.test.ts` — verifies `WWW-Authenticate` header on unauthenticated MCP request.
- `apps/gateway/test/registry.test.ts` — registry contains expected built-ins and merges custom tools.

**Modify:**
- `apps/gateway/package.json` — add `@modelcontextprotocol/sdk`.
- `apps/gateway/src/main.ts` — type Hono `Variables`, use `parseEnv` for all env, single session middleware instance, mount new MCP transport, pino logger, advertise PRM on 401.
- `apps/gateway/src/jsonrpc.ts` — **delete** after Task 1 lands and tests are green.
- `apps/gateway/src/tools/index.ts` — replace 9× boilerplate with array-driven registry that calls into `src/mcp/registry.ts` (or move logic there and re-export).
- `apps/gateway/src/middleware/session.ts` — swap `console.error`/no-op `.catch(() => {})` to pino; add audience check helper for OAuth tokens.
- `packages/env/src/index.ts` — add `MCP_PUBLIC_URL`, `WEB_PUBLIC_URL`, `MCP_PORT` (with sane defaults).

**Delete:**
- `apps/gateway/src/jsonrpc.ts` (after Task 1).

---

## Task 1: Adopt MCP SDK Streamable HTTP transport

**Files:**
- Modify: `apps/gateway/package.json`
- Create: `apps/gateway/src/mcp/registry.ts`
- Create: `apps/gateway/src/mcp/transport.ts`
- Create: `apps/gateway/test/mcp-streamable-http.test.ts`
- Modify: `apps/gateway/src/main.ts:87-134` (replace `mountMcp(app, …)` call site)
- Delete: `apps/gateway/src/jsonrpc.ts`

This is the largest task. It deletes ~165 lines of hand-rolled JSON-RPC and replaces them with the official SDK transport, which gives us: protocol-version negotiation, `Mcp-Session-Id`, `Mcp-Protocol-Version`, GET-for-SSE (server-initiated notifications), notification handling (no response for `id`-less requests), and JSON-RPC batch handling, all maintained upstream.

- [ ] **Step 1: Add the SDK dependency**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm add @modelcontextprotocol/sdk@^1.18.0
```

Expected: `package.json` gains `"@modelcontextprotocol/sdk": "^1.18.0"`. Re-run `pnpm install` at the repo root if the workspace doesn't auto-link.

- [ ] **Step 2: Write the failing integration test for Streamable HTTP**

Create `apps/gateway/test/mcp-streamable-http.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createSessionMiddleware, type McpSessionVars } from '../src/middleware/session.js';
import { mountMcp } from '../src/mcp/transport.js';

// Minimal in-memory DB stub — only the surfaces mountMcp touches.
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

it('responds to initialize and returns Mcp-Session-Id', async () => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
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

it('rejects POST without protocol version header on non-initialize', async () => {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
  });
  expect([400, 406]).toContain(res.status);
});

it('does not respond to JSON-RPC notifications (no id)', async () => {
  // First initialize to get a session id
  const init = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    }),
  });
  const sid = init.headers.get('mcp-session-id')!;
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'mcp-session-id': sid,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  expect(res.status).toBe(202);
});
```

- [ ] **Step 3: Run the test — expect a fail because `src/mcp/transport.ts` doesn't exist**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm test mcp-streamable-http
```

Expected: FAIL with `Cannot find module '../src/mcp/transport.js'`.

- [ ] **Step 4: Move the tool registry into `src/mcp/registry.ts`**

Create `apps/gateway/src/mcp/registry.ts`:

```ts
import { z, type ZodType } from 'zod';
import type { DB } from '@holo/db';
import { listCustomTools, buildCustomToolDefinition } from '@holo/custom-tools';
import { searchInputSchema, runSearchTool } from '../tools/search.js';
import { getPrInputSchema, runGetPrTool } from '../tools/get-pr.js';
import { getThreadInputSchema, runGetThreadTool } from '../tools/get-thread.js';
import { getDocInputSchema, runGetDocTool } from '../tools/get-doc.js';
import { getCallInputSchema, runGetCallTool } from '../tools/get-call.js';
import { getTicketInputSchema, runGetTicketTool } from '../tools/get-ticket.js';
import { listSkillsInputSchema, runListSkillsTool } from '../tools/list-skills.js';
import { getSkillInputSchema, runGetSkillTool } from '../tools/get-skill.js';
import { executeSkillInputSchema, runExecuteSkillTool } from '../tools/execute-skill.js';

export interface ToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  activeToolAllowlist?: string[];
  userId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isCustom?: boolean;
  run(ctx: ToolContext, args: unknown): Promise<unknown>;
}

interface BuiltinSpec {
  name: string;
  description: string;
  schema: ZodType;
  run(ctx: ToolContext, args: unknown): Promise<unknown>;
}

const BUILTINS: BuiltinSpec[] = [
  { name: 'search', description: 'Hybrid search across all ingested artifacts (vector + BM25, fused via RRF).', schema: searchInputSchema, run: (ctx, a) => runSearchTool(ctx, a) },
  { name: 'get_pr', description: 'Reassemble a GitHub PR (title + diff + review) by owner/repo/number.', schema: getPrInputSchema, run: (ctx, a) => runGetPrTool(ctx, a) },
  { name: 'get_thread', description: 'Fetch a Slack thread by channel and ts.', schema: getThreadInputSchema, run: (ctx, a) => runGetThreadTool(ctx, a) },
  { name: 'get_doc', description: 'Fetch a doc by artifact id, notion page id, or repo+path.', schema: getDocInputSchema, run: (ctx, a) => runGetDocTool(ctx, a) },
  { name: 'get_call', description: 'Fetch a Grain meeting recording (summary + full transcript) by recording_id.', schema: getCallInputSchema, run: (ctx, a) => runGetCallTool(ctx, a) },
  { name: 'get_ticket', description: 'Fetch a Pylon support ticket (conversation history) by ticket_id.', schema: getTicketInputSchema, run: (ctx, a) => runGetTicketTool(ctx, a) },
  { name: 'list_skills', description: 'List skills available to agents in this organization. Returns name, slug, version, status, and description. Filter by status (default: active).', schema: listSkillsInputSchema, run: (ctx, a) => runListSkillsTool(ctx, a) },
  { name: 'get_skill', description: 'Retrieve the full content of a skill by id or slug. Returns the complete Anthropic Skill format including procedure and examples.', schema: getSkillInputSchema, run: (ctx, a) => runGetSkillTool(ctx, a) },
  { name: 'execute_skill', description: "Execute a skill procedure step-by-step using the skill's written playbook. The skill must have executable=true in its frontmatter. Returns a run ID, per-step LLM responses, and a summary. This tool creates a skill_run record — it is NOT read-only.", schema: executeSkillInputSchema, run: (ctx, a) => runExecuteSkillTool({ ...ctx, anthropicApiKey: process.env.ANTHROPIC_API_KEY }, a) },
];

export async function listTools(ctx: ToolContext): Promise<ToolDefinition[]> {
  const builtIns: ToolDefinition[] = BUILTINS.map((b) => ({
    name: b.name,
    description: b.description,
    inputSchema: z.toJSONSchema(b.schema) as Record<string, unknown>,
    run: b.run,
  }));

  const customRows = await listCustomTools(ctx.db, ctx.organizationId);
  const customDefs: ToolDefinition[] = customRows.map((row) => {
    const def = buildCustomToolDefinition(row);
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      isCustom: true,
      run: (toolCtx, args) =>
        def.run(
          { db: toolCtx.db, organizationId: toolCtx.organizationId, userId: toolCtx.userId },
          args,
        ),
    };
  });

  return [...builtIns, ...customDefs];
}
```

- [ ] **Step 5: Implement `src/mcp/transport.ts` adapting the SDK to Hono**

Create `apps/gateway/src/mcp/transport.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Hono, Context, Next } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { HoloError } from '@holo/errors';
import { listTools, type ToolContext } from './registry.js';
import { checkToolAllowed } from '../middleware/allowlist.js';
import { logger } from '../logger.js';

export interface MountMcpOpts {
  db: DB;
  resolveContext(c: Context): Promise<ToolContext> | ToolContext;
  middleware?: (c: Context, next: Next) => Promise<void | Response>;
}

// One SDK transport per session id, kept alive for SSE GET reuse.
const transports = new Map<string, StreamableHTTPServerTransport>();

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
    if (!checkToolAllowed(req.params.name, ctx.activeToolAllowlist ?? [], { customToolNames: customNames })) {
      throw new Error(`Tool '${req.params.name}' not in active skill allowlist`);
    }

    const t0 = performance.now();
    const result = await tool.run(ctx, req.params.arguments);
    const latencyMs = Math.round(performance.now() - t0);
    logger.info({ event: 'mcp_tool_call', tool: req.params.name, org: ctx.organizationId, latencyMs });

    ctx.db.insert(schema.mcpInvocations).values({
      organizationId: ctx.organizationId,
      agentIdentity: null,
      toolName: req.params.name,
      inputJson: (req.params.arguments ?? {}) as Record<string, unknown>,
      outputJson: result as Record<string, unknown>,
      latencyMs,
    }).catch((err: unknown) => logger.error({ err }, 'mcp invocation log failed'));

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
        const wwwAuth = `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', c.req.url).toString()}"`;
        return c.json(err.toJSON(), 401, { 'WWW-Authenticate': wwwAuth });
      }
      throw err;
    }

    const sessionId = c.req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => transports.set(sid, transport!),
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildServer(() => ctx);
      await server.connect(transport);
    }

    // SDK transport speaks Node req/res. Hono on @hono/node-server exposes them via c.env.incoming/outgoing.
    const nodeReq = (c.env as { incoming?: import('node:http').IncomingMessage }).incoming;
    const nodeRes = (c.env as { outgoing?: import('node:http').ServerResponse }).outgoing;
    if (!nodeReq || !nodeRes) {
      return c.json({ code: 'HOLO_INTERNAL', problem: 'node req/res not available' }, 500);
    }
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
    await transport.handleRequest(nodeReq, nodeRes, body);
    // Response was streamed via nodeRes; return a no-op so Hono doesn't double-respond.
    return c.body(null);
  };

  if (opts.middleware) {
    app.all('/mcp', opts.middleware, handler);
  } else {
    app.all('/mcp', handler);
  }
}
```

> **Why `app.all`:** the spec requires both POST (client→server JSON-RPC) and GET (server→client SSE stream) on the same endpoint. DELETE is also defined for explicit session teardown — `all` covers it.

- [ ] **Step 6: Update `main.ts` to import from `./mcp/transport.js`**

In `apps/gateway/src/main.ts`, replace line 9:

```ts
import { mountMcp } from './mcp/transport.js';
```

(Type the app: `const app = new Hono<{ Variables: McpSessionVars }>();` — full main.ts changes are in Task 4. For now this single line is enough to swap transports.)

- [ ] **Step 7: Run the new test — expect PASS**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm test mcp-streamable-http
```

Expected: PASS on all three cases. If the SDK rejects requests without `Accept: application/json, text/event-stream`, update the test headers — that is correct spec behavior.

- [ ] **Step 8: Run the existing gateway test suite to confirm no regressions**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm test
```

Expected: all pre-existing tests pass. The old `jsonrpc.ts` is still on disk but unreferenced.

- [ ] **Step 9: Delete the old hand-rolled handler and the old `tools/index.ts` shell**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && rm src/jsonrpc.ts
```

Then in `apps/gateway/src/tools/index.ts`, replace the entire file with a re-export so existing REST callers keep working:

```ts
export { listTools, type ToolContext, type ToolDefinition } from '../mcp/registry.js';
```

Run typecheck:

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/gateway/package.json apps/gateway/src/mcp apps/gateway/src/tools/index.ts apps/gateway/test/mcp-streamable-http.test.ts pnpm-lock.yaml
git rm apps/gateway/src/jsonrpc.ts
git commit -m "feat(gateway): adopt MCP SDK Streamable HTTP transport

Replaces 165 LOC of hand-rolled JSON-RPC with the official
@modelcontextprotocol/sdk transport. Brings the gateway to spec
2025-06-18: session ids, protocol-version negotiation, GET-for-SSE,
correct notification handling (no response for id-less requests),
batch support. Tools collapse to a single data-driven array."
```

---

## Task 2: Type Hono `Variables` end-to-end, drop `as never` casts

**Files:**
- Modify: `apps/gateway/src/main.ts:22,44,91`

- [ ] **Step 1: Type the root app**

In `apps/gateway/src/main.ts`, replace line 22:

```ts
const app = new Hono<{ Variables: McpSessionVars }>();
```

And add the import alongside the existing session import:

```ts
import { createSessionMiddleware, type McpSessionVars } from './middleware/session.js';
```

- [ ] **Step 2: Drop the `as never` casts**

Line 44:

```ts
app.get('/_session-check', createSessionMiddleware(db), (c) => c.json({ user: c.get('user') }));
```

Lines 90-93:

```ts
async resolveContext(c) {
  const user = c.get('user');
  if (!user) {
    throw new HoloError({ /* unchanged */ });
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm typecheck
```

Expected: no errors. If the `mountMcp` callback's `c` is untyped, parameterize `MountMcpOpts.resolveContext` as `(c: Context<{ Variables: McpSessionVars }>)` in `src/mcp/transport.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/gateway/src/main.ts apps/gateway/src/mcp/transport.ts
git commit -m "refactor(gateway): type Hono Variables, drop \`as never\` casts"
```

---

## Task 3: Single pino logger, remove all `console.*`

**Files:**
- Create: `apps/gateway/src/logger.ts`
- Modify: `apps/gateway/src/main.ts:34,138,142`
- Modify: `apps/gateway/src/middleware/session.ts:54`
- Modify: `apps/gateway/src/mcp/transport.ts` (already uses `logger` — verify)

- [ ] **Step 1: Create the shared logger**

Create `apps/gateway/src/logger.ts`:

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'gateway' },
});
```

- [ ] **Step 2: Replace all `console.*` calls in `main.ts`**

In `apps/gateway/src/main.ts`, add `import { logger } from './logger.js';` near the top.

Line 34: `console.error(err);` → `logger.error({ err }, 'unhandled gateway error');`
Line 138: `console.log(\`apps/gateway listening on :${port}\`);` → `logger.info({ port }, 'gateway listening');`
Line 142: `console.error(e);` → `logger.fatal({ err: e }, 'gateway boot failed');`

- [ ] **Step 3: Replace `console.error` and silent catches in `session.ts`**

In `apps/gateway/src/middleware/session.ts`:

Add `import { logger } from '../logger.js';` at the top.

Line 54 (the silent `.catch(() => {})`):

```ts
.catch((err) => logger.warn({ err }, 'lastUsedAt update failed'));
```

- [ ] **Step 4: Run tests + typecheck**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm typecheck && pnpm test
```

Expected: green. Pino writes to stdout — vitest captures it; tests don't assert on log output.

- [ ] **Step 5: Grep to confirm no `console.` left in src**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && grep -rn "console\." src/ || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/gateway/src
git commit -m "refactor(gateway): replace console.* with shared pino logger"
```

---

## Task 4: Move gateway env into `@holo/env`

**Files:**
- Modify: `packages/env/src/index.ts`
- Modify: `apps/gateway/src/main.ts:18-20,109,136`

- [ ] **Step 1: Extend the env schema**

In `packages/env/src/index.ts`, add three lines inside `EnvSchema`:

```ts
MCP_PUBLIC_URL: z.url().default('http://localhost:8080'),
WEB_PUBLIC_URL: z.url().optional(),
MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
```

- [ ] **Step 2: Use them in `main.ts`**

Replace lines 18-20:

```ts
const mcpPublicUrl = env.MCP_PUBLIC_URL;
const webPublicUrl = env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL;
```

Replace line 109 (inside `resolveContext`) — pass the key into `runExecuteSkillTool` via the registry instead of reading `process.env` there. In `apps/gateway/src/mcp/registry.ts`, change the `execute_skill` `BUILTINS` entry's `run`:

```ts
run: (ctx, a) => runExecuteSkillTool({ ...ctx, anthropicApiKey: ctx.anthropicApiKey }, a),
```

And add to `ToolContext`:

```ts
anthropicApiKey?: string;
```

Then in `main.ts`'s `resolveContext` return value:

```ts
return { db, organizationId: user.organizationId, userId: user.userId, userSubjects: [...], activeToolAllowlist, anthropicApiKey: env.ANTHROPIC_API_KEY };
```

Replace line 136:

```ts
const port = env.MCP_PORT;
```

- [ ] **Step 3: Typecheck + test**

```bash
cd /Users/maakle/Developer/holo && pnpm -r typecheck && pnpm --filter @holo/gateway test
```

Expected: green. If a test bootstraps without these env vars, set them in the test setup (`MCP_PUBLIC_URL=http://localhost MCP_PORT=8080 WEB_PUBLIC_URL=http://localhost`).

- [ ] **Step 4: Commit**

```bash
git add packages/env apps/gateway/src
git commit -m "refactor(gateway): centralize env access through @holo/env"
```

---

## Task 5: OAuth 401 advertises PRM, audience check on access tokens

**Files:**
- Modify: `apps/gateway/src/middleware/session.ts`
- Modify: `apps/gateway/src/main.ts:24-39` (onError) and the new MCP handler in `src/mcp/transport.ts` (already added in Task 1, Step 5)
- Modify: `packages/oauth-provider/src/index.ts` — add `audience` field to `validateAccessToken` return (only if not already present)
- Create: `apps/gateway/test/oauth-401-metadata.test.ts`

- [ ] **Step 1: Inspect the existing oauth-provider return shape**

```bash
cd /Users/maakle/Developer/holo && grep -n "validateAccessToken" packages/oauth-provider/src/*.ts
```

If `validateAccessToken` does not already return the token's recorded resource/audience, add it. Spec (RFC 8707) requires the AS bind tokens to a specific resource; the gateway must reject tokens whose audience ≠ `MCP_PUBLIC_URL`.

- [ ] **Step 2: Enforce the audience in `session.ts`**

In `apps/gateway/src/middleware/session.ts`, after the `validateAccessToken` call (around line 22):

```ts
const oauth = await validateAccessToken(db, token);
if (oauth) {
  if (oauth.audience && oauth.audience !== process.env.MCP_PUBLIC_URL) {
    logger.warn({ aud: oauth.audience }, 'oauth token audience mismatch — rejecting');
    // fall through to other auth methods rather than 401-ing here; the request
    // will end up unauthenticated and the MCP handler will issue a proper 401.
  } else {
    c.set('user', { userId: oauth.userId, organizationId: oauth.organizationId, email: '' });
    await next();
    return;
  }
}
```

- [ ] **Step 3: Write the failing test for the 401 metadata header**

Create `apps/gateway/test/oauth-401-metadata.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { mountMcp } from '../src/mcp/transport.js';
import { HoloError } from '@holo/errors';

it('401 on /mcp includes WWW-Authenticate with resource_metadata', async () => {
  const app = new Hono();
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
    headers: { 'content-type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
  });
  expect(res.status).toBe(401);
  const wwwAuth = res.headers.get('www-authenticate');
  expect(wwwAuth).toMatch(/^Bearer\s+resource_metadata="/);
  expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
});
```

- [ ] **Step 4: Run the test — expect PASS**

(The header logic was added in Task 1, Step 5 of `transport.ts`. If it was missed, add it now: when `resolveContext` throws a `HoloError`, return `c.json(err.toJSON(), 401, { 'WWW-Authenticate': \`Bearer resource_metadata="${prmUrl}"\` })`.)

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm test oauth-401-metadata
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gateway packages/oauth-provider
git commit -m "feat(gateway): advertise PRM on 401, enforce token audience (RFC 8707/9728)"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full repo typecheck**

```bash
cd /Users/maakle/Developer/holo && pnpm -r typecheck
```

Expected: zero errors.

- [ ] **Step 2: Full gateway test suite**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm test
```

Expected: all green, including pre-existing `allowlist.test.ts`, `health.test.ts`, `session-middleware.test.ts`, `oauth-roundtrip.test.ts`, `per-user-acl.test.ts`, `custom-tools-roundtrip.test.ts`, `execute-skill.test.ts`, plus the two new ones.

- [ ] **Step 3: Smoke-test the live server**

```bash
cd /Users/maakle/Developer/holo/apps/gateway && pnpm dev
```

In another terminal:

```bash
# OAuth metadata still served
curl -s http://localhost:8080/.well-known/oauth-protected-resource | jq .

# Initialize an MCP session and capture the session id
curl -is -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'authorization: Bearer <a real token>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | tee /tmp/init.txt
```

Expected: `200 OK`, `mcp-session-id` header present, JSON-RPC `result` body with `protocolVersion: "2025-06-18"`.

- [ ] **Step 4: Connect with Claude Desktop or `mcp-inspector`**

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://localhost:8080/mcp` with a bearer token. Confirm `tools/list` returns all 9 built-ins + any custom tools, and `tools/call` for `list_skills` succeeds end-to-end.

---

## Self-Review Notes

- **Spec coverage:** all 5 priority items from the 2026-05-03 review map to tasks (Task 1 = SDK adoption + protocol version + Streamable HTTP + sessions + notifications + batch; Task 2 = Hono types; Task 3 = pino; Task 4 = env; Task 5 = OAuth 401 + audience).
- **Type consistency:** `ToolContext` keeps the same shape across `tools/index.ts` (re-export) and `mcp/registry.ts`; `mountMcp` signature unchanged from caller's perspective.
- **Frequent commits:** one commit per task, ~5 commits total.
- **No orphans:** `jsonrpc.ts` deleted in Task 1 Step 9 once the new path is green.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-03-gateway-mcp-modernization.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?


## Follow-ups (deferred from Task 5)

**RFC 8707 token audience binding.** The original Task 5 called for rejecting OAuth access tokens whose audience ≠ `MCP_PUBLIC_URL`. The current `oauth_access_tokens` schema (`packages/db/src/schema/holo.ts:443`) has no `audience` / `resource` column, so this requires:

1. Add `audience text` (or `resource text`) column to `oauth_access_tokens`, with a migration.
2. Update `mintAccessToken` (`packages/oauth-provider/src/tokens.ts:20`) to take an `audience` param and persist it.
3. Update `validateAccessToken` to return the `audience`, and have `apps/gateway/src/middleware/session.ts` reject tokens whose `audience` doesn't match `env.MCP_PUBLIC_URL`.
4. Update the `/oauth/authorize` and `/oauth/token` routes in the web app to accept and bind the `resource` parameter (RFC 8707 §2).

This is a meaningful expansion of the OAuth flow and warrants its own ticket so it can be discussed and rolled out with backwards-compatibility considerations (existing tokens have no audience and would be rejected — need a grace period or a one-time backfill).
