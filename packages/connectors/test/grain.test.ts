import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createGrainSpec } from '../src/grain/index';

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
        return { accessToken: 'grain_test_token' };
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

function makeRecording(partial: { id: string; startedAt: string; title?: string }): unknown {
  return {
    id: partial.id,
    title: partial.title ?? `Call ${partial.id}`,
    start_datetime: partial.startedAt,
    end_datetime: partial.startedAt,
    duration_ms: 60_000,
    url: `https://grain.com/recording/${partial.id}`,
    source: 'zoom',
    media_type: 'video',
    tags: [],
    teams: [],
    participants: [{ id: 'u1', name: 'Alice', email: null, scope: 'host', confirmed_attendee: true }],
    ai_summary: { text: 'Summary text' },
  };
}

describe('createGrainSpec', () => {
  it('declares one resource and uses Grain http base url', () => {
    const spec = createGrainSpec();
    expect(spec.id).toBe('grain');
    expect(spec.http?.baseUrl).toBe('https://api.grain.com');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('recordings');
    expect(spec.auth.kind).toBe('apiKey');
  });
});

describe('Grain sync — full sweep', () => {
  it('paginates recordings, fetches per-recording transcripts, advances cursor', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/recordings') && req.method === 'POST') {
        const cursor = (req.body as { cursor?: string } | null)?.cursor;
        if (cursor === 'page-2') {
          return jsonResponse({
            recordings: [makeRecording({ id: 'r3', startedAt: '2026-05-03T10:00:00Z' })],
            cursor: null,
          });
        }
        return jsonResponse({
          recordings: [
            makeRecording({ id: 'r1', startedAt: '2026-05-01T10:00:00Z' }),
            makeRecording({ id: 'r2', startedAt: '2026-05-02T10:00:00Z' }),
          ],
          cursor: 'page-2',
        });
      }
      // Transcript GET.
      return jsonResponse([
        { speaker: 'Alice', start: 0, end: 1000, text: 'hello', participant_id: 'u1' },
      ]);
    });

    const spec = createGrainSpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores();

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThan(0);
    expect(enqueued.length).toBeGreaterThan(0);
    // Every chunk indexes into a parent grain-call artifact.
    expect(enqueued[0]!.kind).toBe('grain-call');
    expect(enqueued[0]!.sourceArtifactId).toBe('grain-call:r1');

    // Two recordings POSTs (page 1, page 2).
    const listCalls = calls.filter(
      (c) => c.url.endsWith('/recordings') && c.method === 'POST',
    );
    expect(listCalls).toHaveLength(2);
    expect((listCalls[1]!.body as { cursor?: string }).cursor).toBe('page-2');

    // Cursor advances to the highest start_datetime seen.
    expect(result.cursorPatch['recordings']).toEqual({
      latestStartedAt: '2026-05-03T10:00:00Z',
    });
    expect(savedCursors.at(-1)?.cursor).toEqual({
      latestStartedAt: '2026-05-03T10:00:00Z',
    });
  });

  it('attaches the Public-Api-Version header on every API call', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ recordings: [], cursor: null }),
    );
    const spec = createGrainSpec({ fetchImpl });
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Public-Api-Version')).toBe('2025-10-31');
  });

  it('sends Authorization: Bearer <token> on every API call', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ recordings: [], cursor: null }),
    );
    const spec = createGrainSpec({ fetchImpl });
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer grain_test_token');
  });

  it('continues indexing the recording when its transcript call fails', async () => {
    let transcriptAttempts = 0;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/recordings') && req.method === 'POST') {
        return jsonResponse({
          recordings: [makeRecording({ id: 'r1', startedAt: '2026-05-01T10:00:00Z' })],
          cursor: null,
        });
      }
      transcriptAttempts += 1;
      return jsonResponse({}, { status: 500 });
    });
    const spec = createGrainSpec({ fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(transcriptAttempts).toBeGreaterThan(0);
    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued[0]!.sourceArtifactId).toBe('grain-call:r1');
  });
});

describe('Grain sync — incremental', () => {
  it('never sends a date filter in the request body (Grain rejects unknown props)', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/recordings') && req.method === 'POST') {
        return jsonResponse({
          recordings: [makeRecording({ id: 'r9', startedAt: '2026-05-05T10:00:00Z' })],
          cursor: null,
        });
      }
      return jsonResponse([]);
    });
    const spec = createGrainSpec({ fetchImpl });
    const { stores } = makeStores({
      cursors: { recordings: { latestStartedAt: '2026-05-04T00:00:00Z' } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const list = calls.find(
      (c) => c.url.endsWith('/recordings') && c.method === 'POST',
    );
    const body = list!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('after_datetime');
    expect(Object.keys(body).sort()).toEqual(['include']);
  });

  it('skips recordings older than the stored cursor without fetching their transcripts', async () => {
    let transcriptFetches = 0;
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/recordings') && req.method === 'POST') {
        return jsonResponse({
          recordings: [
            makeRecording({ id: 'old', startedAt: '2026-05-03T10:00:00Z' }),
            makeRecording({ id: 'new', startedAt: '2026-05-05T10:00:00Z' }),
          ],
          cursor: null,
        });
      }
      transcriptFetches += 1;
      return jsonResponse([
        { speaker: 'Alice', start: 0, end: 1000, text: 'hi', participant_id: 'u1' },
      ]);
    });
    const spec = createGrainSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { recordings: { latestStartedAt: '2026-05-04T00:00:00Z' } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    // Only the newer recording is processed: one transcript fetch, no chunks
    // emitted for the older one.
    expect(transcriptFetches).toBe(1);
    expect(enqueued.every((c) => c.sourceArtifactId === 'grain-call:new')).toBe(true);
    // Sanity: list call had no date filter.
    const list = calls.find(
      (c) => c.url.endsWith('/recordings') && c.method === 'POST',
    );
    expect(list!.body as Record<string, unknown>).not.toHaveProperty('after_datetime');
  });
});

describe('Grain testConnection', () => {
  it('returns the singleton workspace identity after a successful list call', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ recordings: [], cursor: null }),
    );
    const spec = createGrainSpec({ fetchImpl });
    const { createHttpClient } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens: { accessToken: 'g' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 'g' } });
    expect(result.externalId).toBe('grain');
    expect(result.name).toBe('Grain Workspace');
  });
});
