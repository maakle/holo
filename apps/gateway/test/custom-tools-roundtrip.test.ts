import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { createCustomTool, deleteCustomToolByName } from '@holo/custom-tools';
import { mountMcp } from '../src/mcp/transport.js';

const here = dirname(fileURLToPath(import.meta.url));
const ECHO = resolve(here, '../../../packages/custom-tools/test/fixtures/echo-tool.sh');
const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let app: Hono;
let orgId: string;
let userId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);
  const orgRow = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  const userRow = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  orgId = orgRow[0]!.id;
  userId = userRow[0]!.id;

  app = new Hono();
  mountMcp(app, {
    db,
    async resolveContext() {
      return {
        db,
        organizationId: orgId,
        userId,
        userSubjects: [`org:${orgId}`],
        activeToolAllowlist: ['echo_argv'],
      };
    },
  });
});

afterAll(async () => {
  await deleteCustomToolByName(db, orgId, 'echo_argv').catch(() => {});
  await sql.end();
});

/** Initialize a session against a Hono app and return its session id. */
async function init(targetApp: Hono): Promise<string> {
  const res = await targetApp.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      }),
    }),
  );
  const sid = res.headers.get('mcp-session-id');
  if (!sid) throw new Error(`init failed: ${res.status} ${await res.text()}`);
  return sid;
}

async function parseSseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice('data: '.length));
  }
  return JSON.parse(text);
}

async function call(
  targetApp: Hono,
  sessionId: string,
  method: string,
  params: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await targetApp.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  if (res.status !== 200) return { status: res.status, body: await res.text().catch(() => null) };
  return { status: res.status, body: await parseSseJson(res) };
}

describe('custom tool roundtrip', () => {
  it('registers, lists, and invokes a custom tool end-to-end', async () => {
    await createCustomTool(db, {
      organizationId: orgId,
      createdBy: userId,
      name: 'echo_argv',
      description: 'echo a phrase',
      command: ECHO,
      argsTemplate: ['{{phrase}}'],
      inputSchema: {
        type: 'object',
        properties: { phrase: { type: 'string' } },
        required: ['phrase'],
        additionalProperties: false,
      },
      envAllowlist: [],
      scope: 'test',
      readOnly: true,
      timeoutMs: 5000,
      maxOutputBytes: 8192,
    });

    const sid = await init(app);
    const listed = (await call(app, sid, 'tools/list', {})).body as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const echo = listed.result.tools.find((t) => t.name === 'echo_argv');
    expect(echo).toBeDefined();
    expect(echo!.description).toContain('[CUSTOM');
    expect(echo!.description).toContain('read-only');
    expect(echo!.description).toContain('scope: test');

    const called = (await call(app, sid, 'tools/call', {
      name: 'echo_argv',
      arguments: { phrase: 'hello-world' },
    })).body as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(called.result.content[0]!.text) as {
      stdout: string;
      exit_code: number;
    };
    expect(payload.exit_code).toBe(0);
    expect(payload.stdout).toContain('hello-world');

    let audit: { event_type: string }[] = [];
    for (let i = 0; i < 20; i++) {
      audit = await sql<{ event_type: string }[]>`
        SELECT event_type FROM audit_events
         WHERE organization_id = ${orgId}
           AND event_type = 'custom_tool.invoked'
         ORDER BY created_at DESC
         LIMIT 1
      `;
      if (audit[0]) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(audit[0]?.event_type).toBe('custom_tool.invoked');
  });

  it('blocks invocation when active allowlist excludes the tool', async () => {
    const isolatedApp = new Hono();
    mountMcp(isolatedApp, {
      db,
      async resolveContext() {
        return {
          db,
          organizationId: orgId,
          userId,
          userSubjects: [`org:${orgId}`],
          activeToolAllowlist: ['search'], // does NOT include echo_argv
        };
      },
    });
    const sid = await init(isolatedApp);
    const { body } = await call(isolatedApp, sid, 'tools/call', {
      name: 'echo_argv',
      arguments: { phrase: 'x' },
    });
    // SDK reports tool errors via JSON-RPC error or isError content; either way it MUST NOT succeed.
    const env = body as
      | { error?: { message?: string }; result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    const errMsg = env.error?.message ?? env.result?.content?.[0]?.text ?? '';
    expect(env.error || env.result?.isError).toBeTruthy();
    expect(String(errMsg)).toMatch(/allowlist|not (in|allowed)/i);
  });

  it('writes audit row for non-zero exit', async () => {
    const failName = 'echo_argv_fail';
    await deleteCustomToolByName(db, orgId, failName).catch(() => {});
    await createCustomTool(db, {
      organizationId: orgId,
      createdBy: userId,
      name: failName,
      description: 'always fails',
      command: '/bin/sh',
      argsTemplate: ['-c', 'exit 7'],
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      envAllowlist: [],
      scope: null,
      readOnly: true,
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });

    const failApp = new Hono();
    mountMcp(failApp, {
      db,
      async resolveContext() {
        return {
          db,
          organizationId: orgId,
          userId,
          userSubjects: [`org:${orgId}`],
          activeToolAllowlist: [failName],
        };
      },
    });

    const sid = await init(failApp);
    const { body } = await call(failApp, sid, 'tools/call', {
      name: failName,
      arguments: {},
    });
    const env = body as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(env.result.content[0]!.text) as { exit_code: number };
    expect(payload.exit_code).toBe(7);

    let auditRow: { meta: Record<string, unknown> } | undefined;
    for (let i = 0; i < 20 && !auditRow; i++) {
      const rows = await sql<{ meta: Record<string, unknown> }[]>`
        SELECT meta FROM audit_events
         WHERE organization_id = ${orgId}
           AND event_type = 'custom_tool.invoked'
           AND meta->>'tool_name' = ${failName}
         ORDER BY created_at DESC
         LIMIT 1
      `;
      auditRow = rows[0];
      if (!auditRow) await new Promise((r) => setTimeout(r, 50));
    }
    expect(auditRow).toBeDefined();
    expect(auditRow!.meta.exit_code).toBe(7);

    await deleteCustomToolByName(db, orgId, failName);
  });
});
