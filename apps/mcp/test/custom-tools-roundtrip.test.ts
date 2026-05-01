import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { createCustomTool, deleteCustomToolByName } from '@holo/custom-tools';
import { mountMcp } from '../src/jsonrpc.js';

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
  // Reuse the first org/user in the DB; tests assume seeded data exists.
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

async function jsonRpc(method: string, params: unknown): Promise<unknown> {
  const res = await app.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return res.json();
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

    const listed = (await jsonRpc('tools/list', {})) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const echo = listed.result.tools.find((t) => t.name === 'echo_argv');
    expect(echo).toBeDefined();
    expect(echo!.description).toContain('[CUSTOM');
    expect(echo!.description).toContain('read-only');
    expect(echo!.description).toContain('scope: test');

    const called = (await jsonRpc('tools/call', {
      name: 'echo_argv',
      arguments: { phrase: 'hello-world' },
    })) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(called.result.content[0]!.text) as {
      stdout: string;
      exit_code: number;
    };
    expect(payload.exit_code).toBe(0);
    expect(payload.stdout).toContain('hello-world');

    // Audit row written (emit is fire-and-forget; poll up to ~1s)
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
    const res = await isolatedApp.fetch(
      new Request('http://test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'echo_argv', arguments: { phrase: 'x' } },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
