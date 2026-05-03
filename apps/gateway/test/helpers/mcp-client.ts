import type { Hono } from 'hono';

/** Initialize a session against a Hono app and return its session id. */
export async function init(targetApp: Hono, opts: { token?: string } = {}): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await targetApp.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers,
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

/** Parse an SSE stream body and pull out the first JSON-RPC message. */
export async function parseSseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice('data: '.length));
  }
  return JSON.parse(text);
}

export async function call(
  targetApp: Hono,
  sessionId: string,
  method: string,
  params: unknown,
  opts: { token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-session-id': sessionId,
    'mcp-protocol-version': '2025-06-18',
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await targetApp.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  if (res.status !== 200) return { status: res.status, body: await res.text().catch(() => null) };
  return { status: res.status, body: await parseSseJson(res) };
}
