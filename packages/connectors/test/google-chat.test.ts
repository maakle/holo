import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createGoogleChatSpec } from '../src/google-chat/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: { existingHashes?: string[]; cursors?: Record<string, unknown> }): {
  stores: RuntimeStores;
  enqueued: ChunkRecord[];
  savedCursors: Array<{ resourceId: string; cursor: unknown }>;
} {
  const enqueued: ChunkRecord[] = [];
  const savedCursors: Array<{ resourceId: string; cursor: unknown }> = [];
  const cursors = { ...(initial?.cursors ?? {}) };
  return {
    enqueued,
    savedCursors,
    stores: {
      async loadTokens() {
        return { accessToken: 'gchat_test_token' };
      },
      async loadCursor({ resourceId }) {
        return cursors[resourceId];
      },
      async saveCursor({ resourceId, cursor }) {
        cursors[resourceId] = cursor;
        savedCursors.push({ resourceId, cursor });
      },
      async loadExistingHashes() {
        return new Set(initial?.existingHashes ?? []);
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

describe('createGoogleChatSpec', () => {
  it('declares the expected id, http config, and one resource', () => {
    const spec = createGoogleChatSpec();
    expect(spec.id).toBe('google-chat');
    expect(spec.displayName).toBe('Google Chat');
    expect(spec.http?.baseUrl).toBe('https://chat.googleapis.com');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('threads');
    // The spec attaches a Bearer token via the apiKey strategy — the bridge
    // mints delegated access tokens for the org's service account before
    // each sync (loadGoogleServiceAccountToken). No OAuth refresh.
    expect(spec.auth.kind).toBe('apiKey');
    expect(spec.auth.refreshable).toBe(false);
  });

  it('attaches the bridge-supplied Bearer token on every request', async () => {
    const spec = createGoogleChatSpec();
    const header = spec.auth.authHeader({ accessToken: 'sa-minted-token' });
    expect(header.name).toBe('Authorization');
    expect(header.value).toBe('Bearer sa-minted-token');
  });
});

describe('Google Chat sync (full)', () => {
  it('lists spaces, walks messages, groups by thread, and emits chunks', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.includes('/v1/spaces') && !req.url.includes('/messages')) {
        return jsonResponse({
          spaces: [
            { name: 'spaces/AAA', displayName: 'Engineering', spaceType: 'SPACE' },
            // DM spaces are skipped by the default policy.
            { name: 'spaces/DM1', spaceType: 'DIRECT_MESSAGE' },
          ],
        });
      }
      // /v1/spaces/AAA/messages — return two messages on one thread plus a
      // standalone parent. The thread filter call returns the same thread's
      // full message list.
      if (req.url.includes('/v1/spaces/AAA/messages')) {
        const isThreadFilter = req.url.includes('thread.name');
        if (isThreadFilter) {
          return jsonResponse({
            messages: [
              {
                name: 'spaces/AAA/messages/1',
                sender: { name: 'users/u1', displayName: 'Alice', type: 'HUMAN' },
                createTime: '2026-05-01T10:00:00Z',
                text: 'parent message',
                thread: { name: 'spaces/AAA/threads/T1' },
              },
              {
                name: 'spaces/AAA/messages/2',
                sender: { name: 'users/u2', displayName: 'Bob', type: 'HUMAN' },
                createTime: '2026-05-01T10:05:00Z',
                text: 'reply',
                thread: { name: 'spaces/AAA/threads/T1' },
              },
            ],
          });
        }
        return jsonResponse({
          messages: [
            {
              name: 'spaces/AAA/messages/1',
              sender: { name: 'users/u1', displayName: 'Alice', type: 'HUMAN' },
              createTime: '2026-05-01T10:00:00Z',
              text: 'parent message',
              thread: { name: 'spaces/AAA/threads/T1' },
            },
            {
              name: 'spaces/AAA/messages/2',
              sender: { name: 'users/u2', displayName: 'Bob', type: 'HUMAN' },
              createTime: '2026-05-01T10:05:00Z',
              text: 'reply',
              thread: { name: 'spaces/AAA/threads/T1' },
            },
          ],
        });
      }
      return jsonResponse({});
    });

    const spec = createGoogleChatSpec();
    const { stores, enqueued, savedCursors } = makeStores();

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThan(0);
    // Exactly one thread chunk — the two messages collapse onto the same
    // thread and we dedupe to emit it once.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.kind).toBe('google-chat-thread');
    expect(enqueued[0]!.provider).toBe('google-chat');
    expect(enqueued[0]!.sourceArtifactId).toBe(
      'google-chat-thread:spaces/AAA/threads/T1',
    );
    // Chunk content stitches messages in createTime order.
    expect(enqueued[0]!.content).toContain('@Alice');
    expect(enqueued[0]!.content).toContain('@Bob');
    // ACL anchors on the space resource name.
    expect(enqueued[0]!.aclSubjects).toContain('google-chat-space:spaces/AAA');

    // DM space was filtered out — no /v1/spaces/DM1/messages call.
    expect(calls.some((c) => c.url.includes('/v1/spaces/DM1/messages'))).toBe(false);

    // Cursor advances to the highest createTime seen in the space.
    expect(result.cursorPatch['threads']).toEqual({
      createdAfterPerSpace: { 'spaces/AAA': '2026-05-01T10:05:00Z' },
    });
    expect(savedCursors.at(-1)).toMatchObject({
      resourceId: 'threads',
    });
  });

  it('attaches Authorization: Bearer <token> on every request', async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ spaces: [] }));
    const spec = createGoogleChatSpec();
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer gchat_test_token');
  });

  it('skips bot senders even when they post in an allowed space', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/v1/spaces?pageSize=1000')) {
        return jsonResponse({
          spaces: [{ name: 'spaces/AAA', displayName: 'Eng', spaceType: 'SPACE' }],
        });
      }
      // Both list + thread-filter calls return only a bot message → no chunks.
      return jsonResponse({
        messages: [
          {
            name: 'spaces/AAA/messages/bot1',
            sender: { name: 'users/bot', displayName: 'Holo', type: 'BOT' },
            createTime: '2026-05-01T10:00:00Z',
            text: 'automated note',
            thread: { name: 'spaces/AAA/threads/T1' },
          },
        ],
      });
    });
    const spec = createGoogleChatSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued).toHaveLength(0);
  });
});

describe('Google Chat sync (incremental)', () => {
  it('passes the stored createTime watermark as a filter', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.includes('/v1/spaces') && !req.url.includes('/messages')) {
        return jsonResponse({
          spaces: [{ name: 'spaces/AAA', displayName: 'Eng', spaceType: 'SPACE' }],
        });
      }
      return jsonResponse({ messages: [] });
    });
    const spec = createGoogleChatSpec();
    const { stores } = makeStores({
      cursors: {
        threads: {
          createdAfterPerSpace: { 'spaces/AAA': '2026-05-01T00:00:00Z' },
        },
      },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const messagesCall = calls.find(
      (c) => c.url.includes('/v1/spaces/AAA/messages') && !c.url.includes('thread.name'),
    );
    expect(messagesCall).toBeDefined();
    expect(messagesCall!.url).toContain('createTime');
    expect(messagesCall!.url).toContain('2026-05-01T00%3A00%3A00Z');
  });
});

describe('Google Chat testConnection', () => {
  it('returns the workspace email domain from userinfo', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ sub: 'sub-1', email: 'alice@kombo.dev' }),
    );
    const spec = createGoogleChatSpec();
    const { createHttpClient } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens: { accessToken: 't' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 't' } });
    expect(result.externalId).toBe('kombo.dev');
    expect(result.name).toContain('kombo.dev');
  });
});
