import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createConfluenceSpec } from '../../src/confluence';
import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf-8'));
}

function makeMockFetch(handlers: Array<(url: string, init: RequestInit) => Promise<Response> | null>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const rawHeaders = init.headers;
    const normalizedHeaders: Record<string, string> = {};
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => { normalizedHeaders[key] = value; });
    } else if (rawHeaders && typeof rawHeaders === 'object') {
      Object.assign(normalizedHeaders, rawHeaders);
    }
    const normalizedInit = { ...init, headers: normalizedHeaders } as RequestInit;
    calls.push({ url, init: normalizedInit });
    for (const h of handlers) {
      const res = await h(url, normalizedInit);
      if (res) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makePagesCtx(opts: { siteUrl: string; cursor?: { updatedAt?: string } }) {
  const upserts: ChunkUpsert[] = [];
  const flushed: Array<{ updatedAt?: string }> = [];
  const ctx: ResourceSyncContext<{ updatedAt?: string }> = {
    organizationId: 'org-1',
    sourceId: 'src-1',
    tokens: { accessToken: 'Zm9vQGV4YW1wbGUuY29tOnRva2Vu' },
    api: {} as ResourceSyncContext<unknown>['api'],
    paginate: {} as ResourceSyncContext<unknown>['paginate'],
    cursor: opts.cursor ?? {},
    allowlist: [],
    sourceMetadata: { siteUrl: opts.siteUrl },
    async upsert(chunk) {
      upserts.push(chunk);
    },
    async flushCursor(c) {
      flushed.push(c);
    },
  };
  return { ctx, upserts, flushed };
}

describe('createConfluenceSpec', () => {
  it('declares id="confluence", apiKey Basic auth, and two resources', () => {
    const spec = createConfluenceSpec();
    expect(spec.id).toBe('confluence');
    expect(spec.displayName).toBe('Confluence');
    expect(spec.auth.kind).toBe('apiKey');
    expect(spec.resources.map((r) => r.id).sort()).toEqual(['pages', 'spaces']);
  });

  it('pages sync emits page + comment chunks, attributes space ACL, advances cursor watermark', async () => {
    const page1 = await loadFixture('content-page-1.json');
    const { fetchImpl, calls } = makeMockFetch([
      async (url) => {
        if (!url.includes('/wiki/rest/api/content/search')) return null;
        return jsonResponse(page1);
      },
    ]);

    const spec = createConfluenceSpec({ fetchImpl });
    const pagesResource = spec.resources.find((r) => r.id === 'pages')!;
    const { ctx, upserts, flushed } = makePagesCtx({ siteUrl: 'https://acme.atlassian.net' });

    const finalCursor = await pagesResource.sync(ctx);

    const kinds = upserts.map((u) => u.kind);
    expect(kinds.filter((k) => k === 'confluence-page')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'confluence-comment')).toHaveLength(1);

    // Cursor watermark = max(version.when) across the page batch.
    expect(finalCursor.updatedAt).toBe('2026-05-09T15:22:00.000Z');
    // Per-batch flush after the only page (results.length < limit, so loop exits).
    expect(flushed.length).toBeGreaterThanOrEqual(1);

    // Hits acme.atlassian.net per-tenant URL, not the placeholder.
    expect(calls[0].url.startsWith('https://acme.atlassian.net/')).toBe(true);

    // Auth header = Basic <base64>.
    const authHeader =
      (calls[0].init.headers as Record<string, string>)['Authorization'] ??
      (calls[0].init.headers as Record<string, string>)['authorization'];
    expect(authHeader).toBe('Basic Zm9vQGV4YW1wbGUuY29tOnRva2Vu');

    // ACL contains both the space-scoped subject and the org subject.
    const pageChunk = upserts.find((u) => u.kind === 'confluence-page')!;
    expect(pageChunk.aclSubjects).toEqual(
      expect.arrayContaining(['confluence:space:s-1', 'confluence:org']),
    );
    // Comment chunk shares the page's source-artifact id (deletions cascade).
    const commentChunk = upserts.find((u) => u.kind === 'confluence-comment')!;
    expect(commentChunk.sourceArtifactId).toBe('confluence-page:p-100');
    // Body flattened from ADF.
    expect(pageChunk.content).toContain('Welcome to the eng team.');
    // Ancestor breadcrumb survives into the chunk text.
    expect(pageChunk.content).toContain('Engineering › Handbooks');
  });

  it('pages sync resumes from cursor.updatedAt with a CQL "lastModified >=" filter', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      async (url) => {
        if (!url.includes('/wiki/rest/api/content/search')) return null;
        return jsonResponse({ results: [], start: 0, limit: 25, size: 0 });
      },
    ]);

    const spec = createConfluenceSpec({ fetchImpl });
    const pagesResource = spec.resources.find((r) => r.id === 'pages')!;
    const { ctx } = makePagesCtx({
      siteUrl: 'https://acme.atlassian.net',
      cursor: { updatedAt: '2026-05-09T15:22:00.000Z' },
    });

    await pagesResource.sync(ctx);
    const queried = new URL(calls[0].url);
    const cql = queried.searchParams.get('cql') ?? '';
    expect(cql).toContain('lastModified >= "2026-05-09 15:22"');
    expect(cql).toContain('ORDER BY lastModified ASC');
  });

  it('spaces sync emits one chunk per space from a single batch', async () => {
    const spaces = await loadFixture('spaces-page-1.json');
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.includes('/wiki/rest/api/space')) return null;
        return jsonResponse(spaces);
      },
    ]);

    const spec = createConfluenceSpec({ fetchImpl });
    const spacesResource = spec.resources.find((r) => r.id === 'spaces')!;
    const upserts: ChunkUpsert[] = [];
    const ctx: ResourceSyncContext<unknown> = {
      organizationId: 'org-1',
      sourceId: 'src-1',
      tokens: { accessToken: 'Zm9vOmJhcg==' },
      api: {} as ResourceSyncContext<unknown>['api'],
      paginate: {} as ResourceSyncContext<unknown>['paginate'],
      cursor: {},
      allowlist: [],
      sourceMetadata: { siteUrl: 'https://acme.atlassian.net' },
      async upsert(chunk) {
        upserts.push(chunk);
      },
      async flushCursor() {},
    };

    await spacesResource.sync(ctx);
    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.kind === 'confluence-space')).toBe(true);
    expect(upserts.map((u) => u.metadata.key)).toEqual(['ENG', 'OPS']);
  });

  it('throws HOLO_INVALID_INPUT if sources.metadata.siteUrl is missing (pages)', async () => {
    const spec = createConfluenceSpec({ fetchImpl: async () => jsonResponse({}) });
    const pagesResource = spec.resources.find((r) => r.id === 'pages')!;
    const ctx = {
      organizationId: 'org-1',
      sourceId: 'src-1',
      tokens: { accessToken: 'x' },
      api: {} as ResourceSyncContext<unknown>['api'],
      paginate: {} as ResourceSyncContext<unknown>['paginate'],
      cursor: {},
      allowlist: [],
      sourceMetadata: {},
      async upsert() {},
      async flushCursor() {},
    } as ResourceSyncContext<{ updatedAt?: string }>;

    await expect(pagesResource.sync(ctx)).rejects.toMatchObject({
      code: 'HOLO_INVALID_INPUT',
    });
  });

  it('testConnection issues GET /wiki/rest/api/user/current and returns accountId as externalId', async () => {
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/wiki/rest/api/user/current')) return null;
        return jsonResponse({
          accountId: 'u-jane',
          displayName: 'Jane Doe',
          email: 'jane@acme.test',
        });
      },
    ]);
    const spec = createConfluenceSpec({ fetchImpl });
    const result = await spec.testConnection({
      tokens: { accessToken: 'x' },
      api: {
        get: async (path: string) =>
          (await (await fetchImpl(`https://probe.atlassian.net${path}`, {})).json()) as unknown,
      } as unknown as ResourceSyncContext<unknown>['api'],
    });
    expect(result.externalId).toBe('u-jane');
    expect(result.name).toBe('Jane Doe');
  });
});
