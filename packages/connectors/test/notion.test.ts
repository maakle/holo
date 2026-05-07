import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type AllowlistEntry,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { createNotionSpec } from '../src/notion/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  allowlist?: ReadonlyArray<AllowlistEntry>;
}): {
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
        return { accessToken: 'secret_notion_token' };
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
      async loadAllowlist() {
        return initial?.allowlist ?? [];
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

const wildcardAllowlist: ReadonlyArray<AllowlistEntry> = [
  { pattern: '*', patternKind: 'glob', decision: 'include' },
];

const explicitAllowlist: ReadonlyArray<AllowlistEntry> = [
  { pattern: 'page-1', patternKind: 'exact_id', decision: 'include' },
];

function pageBody(id: string, lastEdited: string): unknown {
  return {
    id,
    archived: false,
    last_edited_time: lastEdited,
    last_edited_by: { id: 'user-7' },
    parent: { type: 'workspace', workspace: true },
    properties: {
      title: { type: 'title', title: [{ plain_text: `Page ${id}` }] },
    },
  };
}

describe('createNotionSpec', () => {
  it('declares one resource and the standard Notion http base url', () => {
    const spec = createNotionSpec();
    expect(spec.id).toBe('notion');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('pages');
    expect(spec.http?.baseUrl).toBe('https://api.notion.com/v1');
    expect(spec.auth.kind).toBe('apiKey');
  });

  it('sends the Notion-Version header on every request', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/users/me')) {
        return jsonResponse({ id: 'u1', workspace_name: 'Acme' });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createNotionSpec();
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 't' },
      fetchImpl,
      sleep: async () => {},
    });
    await spec.testConnection({ api, tokens: { accessToken: 't' } });
    expect(calls[0]!.headers.get('Notion-Version')).toBe('2022-06-28');
  });
});

describe('Notion sync — allowlist gating', () => {
  it('throws HOLO_ALLOWLIST_EMPTY when no allowlist rows exist', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}, { status: 404 }));
    const spec = createNotionSpec();
    const { stores } = makeStores({ allowlist: [] });
    await expect(
      runConnectorSync({
        spec,
        stores,
        organizationId: 'o',
        sourceId: 's',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'HOLO_ALLOWLIST_EMPTY' });
  });

  it('expands a wildcard allowlist via /search', async () => {
    let searched = false;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/search')) {
        searched = true;
        return jsonResponse({
          results: [pageBody('p-from-search', '2026-05-01T10:00:00Z')],
          next_cursor: null,
        });
      }
      if (req.url.includes('/pages/p-from-search')) {
        return jsonResponse(pageBody('p-from-search', '2026-05-01T10:00:00Z'));
      }
      // No child blocks.
      if (req.url.includes('/blocks/')) {
        return jsonResponse({ results: [], next_cursor: null });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createNotionSpec();
    const { stores } = makeStores({ allowlist: wildcardAllowlist });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(searched).toBe(true);
  });

  it('uses explicit page ids without calling /search', async () => {
    let searched = false;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/search')) {
        searched = true;
        return jsonResponse({ results: [], next_cursor: null });
      }
      if (req.url.includes('/pages/')) {
        return jsonResponse(pageBody('page-1', '2026-05-01T10:00:00Z'));
      }
      if (req.url.includes('/blocks/')) {
        return jsonResponse({ results: [], next_cursor: null });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createNotionSpec();
    const { stores } = makeStores({ allowlist: explicitAllowlist });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(searched).toBe(false);
  });
});

describe('Notion sync — incremental skip via watermark', () => {
  it("skips pages whose last_edited_time hasn't moved past the cursor", async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/pages/page-1')) {
        return jsonResponse(pageBody('page-1', '2026-05-01T10:00:00Z'));
      }
      if (req.url.includes('/blocks/')) {
        // Block returned so the chunker would run if we decided to. The
        // test asserts we don't enqueue because the watermark matches.
        return jsonResponse({
          results: [
            {
              id: 'b1',
              type: 'paragraph',
              has_children: false,
              paragraph: { rich_text: [{ plain_text: 'hello' }] },
            },
          ],
          next_cursor: null,
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createNotionSpec();
    const { stores, enqueued } = makeStores({
      allowlist: explicitAllowlist,
      cursors: {
        pages: {
          lastEditedPerPage: { 'page-1': '2026-05-01T10:00:00Z' },
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
    expect(enqueued.length).toBe(0);
  });

  it('emits chunks for pages with a fresher last_edited_time', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/pages/page-1')) {
        return jsonResponse(pageBody('page-1', '2026-05-05T10:00:00Z'));
      }
      if (req.url.includes('/blocks/')) {
        return jsonResponse({
          results: [
            {
              id: 'b1',
              type: 'paragraph',
              has_children: false,
              paragraph: { rich_text: [{ plain_text: 'hello' }] },
            },
          ],
          next_cursor: null,
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    const spec = createNotionSpec();
    const { stores, enqueued, savedCursors } = makeStores({
      allowlist: explicitAllowlist,
      cursors: {
        pages: {
          lastEditedPerPage: { 'page-1': '2026-05-01T10:00:00Z' },
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
    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued[0]!.kind).toBe('notion-page');
    expect(enqueued[0]!.sourceArtifactId).toBe('notion-page:page-1');
    // Cursor advances to the new edit time.
    const last = savedCursors.at(-1)?.cursor as {
      lastEditedPerPage: Record<string, string>;
    };
    expect(last.lastEditedPerPage['page-1']).toBe('2026-05-05T10:00:00Z');
  });
});

describe('Notion testConnection', () => {
  it('returns the workspace name from /users/me', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ id: 'u1', name: 'Alice', workspace_name: 'Acme Inc' }),
    );
    const spec = createNotionSpec();
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 't' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 't' } });
    expect(result.externalId).toBe('u1');
    expect(result.name).toBe('Acme Inc');
  });
});
