import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createPylonSpec } from '../src/pylon/index';

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
        return { accessToken: 'pylon_test_key' };
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
  body: unknown;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    let body: unknown = null;
    if (typeof init.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      body,
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

describe('createPylonSpec', () => {
  it('declares the expected id, http config, and one resource', () => {
    const spec = createPylonSpec();
    expect(spec.id).toBe('pylon');
    expect(spec.displayName).toBe('Pylon');
    expect(spec.http?.baseUrl).toBe('https://api.usepylon.com');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('tickets');
    expect(spec.auth.kind).toBe('apiKey');
  });

  it('does not expose buildAuthorizeUrl / exchangeCode (api-key auth)', () => {
    const spec = createPylonSpec();
    expect(spec.auth.buildAuthorizeUrl).toBeUndefined();
    expect(spec.auth.exchangeCode).toBeUndefined();
    expect(spec.auth.refreshable).toBe(false);
  });
});

const baseIssue = {
  number: 1,
  title: 'Login broken',
  body_html: '<p>I cannot sign in</p>',
  type: 'ticket' as const,
  state: 'open',
  source: 'web',
  created_at: '2026-04-01T00:00:00.000Z',
  link: 'https://app.usepylon.com/issues/1',
  tags: ['bug'],
};

describe('Pylon sync (full)', () => {
  it('paginates through tickets, fetches messages, emits chunks', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/issues/search')) {
        const after = (req.body as { cursor?: string } | null)?.cursor;
        if (after === 'page-2') {
          return jsonResponse({
            data: [
              {
                id: 'issue-3',
                ...baseIssue,
                title: 'third',
                updated_at: '2026-05-03T10:00:00Z',
              },
            ],
            pagination: { cursor: null, has_next_page: false },
          });
        }
        return jsonResponse({
          data: [
            {
              id: 'issue-1',
              ...baseIssue,
              title: 'first',
              updated_at: '2026-05-01T10:00:00Z',
            },
            {
              id: 'issue-2',
              ...baseIssue,
              title: 'second',
              updated_at: '2026-05-02T10:00:00Z',
            },
          ],
          pagination: { cursor: 'page-2', has_next_page: true },
        });
      }
      // /issues/<id>/messages — return one short message per ticket.
      return jsonResponse({
        data: [
          {
            id: 'm1',
            thread_id: 't1',
            message_html: '<p>need help</p>',
            is_private: false,
            source: 'email',
            timestamp: '2026-05-01T10:01:00Z',
            file_urls: [],
            author: {
              name: 'Alice',
              avatar_url: '',
              contact: { id: 'c1', email: 'alice@example.com' },
            },
          },
        ],
        pagination: { cursor: null, has_next_page: false },
      });
    });

    const spec = createPylonSpec();
    const { stores, enqueued, savedCursors } = makeStores();

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThan(0);
    // 3 tickets × ≥1 chunk each.
    expect(enqueued.length).toBeGreaterThanOrEqual(3);
    expect(enqueued[0]!.kind).toBe('pylon-ticket');
    expect(enqueued[0]!.provider).toBe('pylon');
    // Crucial: artifact id matches the legacy pylon convention so existing
    // source_artifacts rows survive the migration.
    expect(enqueued[0]!.sourceArtifactId).toBe('pylon-ticket:issue-1');
    // Cursor advances to the highest updated_at seen.
    expect(result.cursorPatch['tickets']).toEqual({
      updatedAt: '2026-05-03T10:00:00Z',
    });
    expect(savedCursors.at(-1)).toEqual({
      resourceId: 'tickets',
      cursor: { updatedAt: '2026-05-03T10:00:00Z' },
    });

    // Two /issues/search POSTs (page 1, page 2) + one /issues/<id>/messages
    // GET per ticket = 5 calls minimum.
    const searchCalls = calls.filter((c) => c.url.endsWith('/issues/search'));
    expect(searchCalls).toHaveLength(2);
    expect((searchCalls[1]!.body as { cursor?: string }).cursor).toBe('page-2');
  });

  it('attaches Authorization: Bearer <key> on every request', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({
        data: [],
        pagination: { cursor: null, has_next_page: false },
      }),
    );
    const spec = createPylonSpec();
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer pylon_test_key');
  });

  it('continues syncing the ticket even when its messages call fails', async () => {
    let messagesAttempt = 0;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/issues/search')) {
        return jsonResponse({
          data: [
            {
              id: 'flaky',
              ...baseIssue,
              title: 'flaky',
              updated_at: '2026-05-04T10:00:00Z',
            },
          ],
          pagination: { cursor: null, has_next_page: false },
        });
      }
      messagesAttempt += 1;
      // Return 500 every time — the framework's retry will retry, then the
      // spec's try/catch swallows the eventual failure.
      return jsonResponse({}, { status: 500 });
    });
    const spec = createPylonSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(messagesAttempt).toBeGreaterThan(0);
    // Ticket still indexed via title/body even without messages.
    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued[0]!.sourceArtifactId).toBe('pylon-ticket:flaky');
  });
});

describe('Pylon sync (incremental)', () => {
  it('passes the stored cursor as updated_at filter', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/issues/search')) {
        return jsonResponse({
          data: [
            {
              id: 'issue-x',
              ...baseIssue,
              title: 'x',
              updated_at: '2026-05-05T10:00:00Z',
            },
          ],
          pagination: { cursor: null, has_next_page: false },
        });
      }
      return jsonResponse({
        data: [],
        pagination: { cursor: null, has_next_page: false },
      });
    });
    const spec = createPylonSpec();
    const { stores } = makeStores({
      cursors: { tickets: { updatedAt: '2026-05-04T00:00:00Z' } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const search = calls.find((c) => c.url.endsWith('/issues/search'));
    expect(search!.body).toMatchObject({
      filter: { updated_at: { time_is_after: '2026-05-04T00:00:00Z' } },
    });
  });

  it('keeps the existing cursor when no new tickets are returned', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: [],
        pagination: { cursor: null, has_next_page: false },
      }),
    );
    const spec = createPylonSpec();
    const { stores, enqueued } = makeStores({
      cursors: { tickets: { updatedAt: '2026-05-04T10:00:00Z' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(result.artifactCount).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(result.cursorPatch['tickets']).toEqual({
      updatedAt: '2026-05-04T10:00:00Z',
    });
  });
});

describe('Pylon testConnection', () => {
  it('returns the org id and name from /me', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ data: { id: 'org-abc', name: 'Holo Inc' } }),
    );
    const spec = createPylonSpec();
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'k' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 'k' } });
    expect(result.externalId).toBe('org-abc');
    expect(result.name).toBe('Holo Inc');
  });
});
