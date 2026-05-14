import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { createWebcrawlSpec } from '../src/webcrawl/index';
import type { FirecrawlPage } from '../src/webcrawl/types';

const TEST_BASE = 'https://firecrawl.invalid/v2';

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
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
        return { accessToken: '' };
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
      async loadSourceMetadata() {
        return initial?.sourceMetadata ?? {};
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
  authorization?: string;
}

function makeFetch(
  responder: (req: CapturedRequest) => { status?: number; body: unknown } | null,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    const captured: CapturedRequest = {
      url: u,
      method: (init?.method ?? 'GET').toUpperCase(),
      ...(body !== undefined ? { body } : {}),
      ...(headers['Authorization'] ? { authorization: headers['Authorization'] } : {}),
    };
    calls.push(captured);
    const resp = responder(captured);
    if (!resp) return new Response('', { status: 404 });
    return new Response(
      typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body),
      {
        status: resp.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

function page(url: string, markdown: string, title = 'Title'): FirecrawlPage {
  return { url, markdown, metadata: { title } };
}

describe('createWebcrawlSpec', () => {
  it('declares one `pages` resource and none auth', () => {
    const spec = createWebcrawlSpec({ apiKey: 'fc_test' });
    expect(spec.id).toBe('webcrawl');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('pages');
    expect(spec.auth.kind).toBe('none');
  });
});

describe('Webcrawl sync — scrape mode', () => {
  it('hits POST /v2/scrape and emits chunks for the page', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/scrape') && req.method === 'POST') {
        return { body: { success: true, data: page('https://example.com/faq', '# FAQ\n\nHallo Welt') } };
      }
      return null;
    });
    const spec = createWebcrawlSpec({ apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: { mode: 'scrape', url: 'https://example.com/faq' },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(1);
    const kinds = new Set(enqueued.map((c) => c.kind));
    expect(kinds.has('webcrawl-page')).toBe(true);

    // Authorization header attached.
    const authed = calls.find((c) => c.url.endsWith('/scrape'));
    expect(authed?.authorization).toBe('Bearer fc_test');
    expect((authed?.body as { formats: string[] }).formats).toEqual(['markdown']);

    const cursor = savedCursors.find((s) => s.resourceId === 'pages')?.cursor as {
      pageHashes: Record<string, string>;
    };
    expect(Object.keys(cursor.pageHashes)).toContain('https://example.com/faq');
  });

  it('skips re-emitting a page whose markdown hash matches the cursor', async () => {
    const markdown = '# FAQ\n\nHallo Welt';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(markdown).digest('hex');

    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/scrape')) {
        return { body: { success: true, data: page('https://example.com/faq', markdown) } };
      }
      return null;
    });
    const spec = createWebcrawlSpec({ apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE });
    const { stores, enqueued } = makeStores({
      cursors: { pages: { pageHashes: { 'https://example.com/faq': hash } } },
      sourceMetadata: { mode: 'scrape', url: 'https://example.com/faq' },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });
    expect(enqueued).toHaveLength(0);
  });

  it('throws HOLO_INVALID_INPUT when sources.metadata is missing/malformed', async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 200, body: {} }));
    const spec = createWebcrawlSpec({ apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE });
    const { stores } = makeStores({ sourceMetadata: { mode: 'oops' } });
    await expect(
      runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });
});

describe('Webcrawl sync — crawl mode', () => {
  it('starts a crawl, polls until completed, emits chunks per page', async () => {
    let pollCount = 0;
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/crawl') && req.method === 'POST') {
        return { body: { success: true, id: 'job-1' } };
      }
      if (req.url.includes('/crawl/job-1') && req.method === 'GET') {
        pollCount += 1;
        // First poll: still scraping with one early result.
        if (pollCount === 1) {
          return {
            body: {
              status: 'scraping',
              completed: 1,
              total: 2,
              data: [page('https://example.com/a', 'A body')],
            },
          };
        }
        // Second poll: completed with both pages.
        return {
          body: {
            status: 'completed',
            completed: 2,
            total: 2,
            next: null,
            data: [
              page('https://example.com/a', 'A body'),
              page('https://example.com/b', 'B body'),
            ],
          },
        };
      }
      return null;
    });
    const spec = createWebcrawlSpec({
      apiKey: 'fc_test',
      fetchImpl,
      baseUrl: TEST_BASE,
      waitFn: async () => {},
    });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: {
        mode: 'crawl',
        seedUrl: 'https://example.com',
        limit: 5,
        maxDepth: 2,
      },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

    const urls = new Set(enqueued.map((c) => c.metadata['url']));
    expect(urls.has('https://example.com/a')).toBe(true);
    expect(urls.has('https://example.com/b')).toBe(true);
    // Same URL should not be emitted twice even though it appeared in both polls.
    const aCount = enqueued.filter((c) => c.metadata['url'] === 'https://example.com/a').length;
    expect(aCount).toBe(1);

    // Crawl POST body carried our limit/depth.
    const startReq = calls.find((c) => c.url.endsWith('/crawl') && c.method === 'POST');
    expect((startReq?.body as { limit: number }).limit).toBe(5);
    expect((startReq?.body as { maxDiscoveryDepth: number }).maxDiscoveryDepth).toBe(2);
    expect((startReq?.body as { allowExternalLinks: boolean }).allowExternalLinks).toBe(false);

    const cursor = savedCursors.find((s) => s.resourceId === 'pages')?.cursor as {
      pageHashes: Record<string, string>;
    };
    expect(Object.keys(cursor.pageHashes).length).toBe(2);
  });

  it('walks the `next` cursor through paginated crawl results', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/crawl') && req.method === 'POST') {
        return { body: { success: true, id: 'job-2' } };
      }
      if (req.url.endsWith('/crawl/job-2') && req.method === 'GET') {
        return {
          body: {
            status: 'completed',
            next: `${TEST_BASE}/crawl/job-2?cursor=2`,
            data: [page('https://example.com/p1', 'page 1')],
          },
        };
      }
      if (req.url.includes('/crawl/job-2?cursor=2')) {
        return {
          body: {
            status: 'completed',
            next: null,
            data: [page('https://example.com/p2', 'page 2')],
          },
        };
      }
      return null;
    });
    const spec = createWebcrawlSpec({
      apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE, waitFn: async () => {},
    });
    const { stores, enqueued } = makeStores({
      sourceMetadata: { mode: 'crawl', seedUrl: 'https://example.com', limit: 5, maxDepth: 2 },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });
    const urls = new Set(enqueued.map((c) => c.metadata['url']));
    expect(urls.has('https://example.com/p1')).toBe(true);
    expect(urls.has('https://example.com/p2')).toBe(true);
  });

  it('throws when Firecrawl reports a failed crawl status', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.endsWith('/crawl') && req.method === 'POST') {
        return { body: { success: true, id: 'job-3' } };
      }
      if (req.url.endsWith('/crawl/job-3')) {
        return { body: { status: 'failed', data: [], error: 'robots.txt disallows' } };
      }
      return null;
    });
    const spec = createWebcrawlSpec({
      apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE, waitFn: async () => {},
    });
    const { stores } = makeStores({
      sourceMetadata: { mode: 'crawl', seedUrl: 'https://example.com', limit: 5, maxDepth: 2 },
    });
    await expect(
      runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl }),
    ).rejects.toMatchObject({ code: 'HOLO_FETCH_FAILED' });
  });

  it('passes includePaths and excludePaths through to Firecrawl', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.endsWith('/crawl') && req.method === 'POST') {
        return { body: { success: true, id: 'job-4' } };
      }
      if (req.url.endsWith('/crawl/job-4')) {
        return { body: { status: 'completed', next: null, data: [] } };
      }
      return null;
    });
    const spec = createWebcrawlSpec({
      apiKey: 'fc_test', fetchImpl, baseUrl: TEST_BASE, waitFn: async () => {},
    });
    const { stores } = makeStores({
      sourceMetadata: {
        mode: 'crawl',
        seedUrl: 'https://example.com',
        limit: 5,
        maxDepth: 2,
        includePaths: ['/faq/*'],
        excludePaths: ['/admin/*'],
      },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

    const startReq = calls.find((c) => c.url.endsWith('/crawl') && c.method === 'POST');
    expect((startReq?.body as { includePaths: string[] }).includePaths).toEqual(['/faq/*']);
    expect((startReq?.body as { excludePaths: string[] }).excludePaths).toEqual(['/admin/*']);
  });
});
