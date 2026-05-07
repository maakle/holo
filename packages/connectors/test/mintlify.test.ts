import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { createMintlifySpec, parseLlmsIndex } from '../src/mintlify/index';

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
        return initial?.sourceMetadata ?? { baseUrl: 'https://docs.example.com' };
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
}

function makeFetch(
  responder: (url: string) => { status?: number; body: string } | null,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: (init?.method ?? 'GET').toUpperCase() });
    const resp = responder(u);
    if (!resp) return new Response('', { status: 404 });
    return new Response(resp.body, {
      status: resp.status ?? 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

const SAMPLE_LLMS_TXT = `# Kombo

> One unified API for HRIS and ATS integrations.

## Get Started

- [Introduction](/introduction): What Kombo does and how it fits.
- [Quickstart](/quickstart): Make your first API call in 5 minutes.

## API Reference

- [Authentication](/api-reference/authentication)
- [Employees](/api-reference/employees)
`;

describe('parseLlmsIndex', () => {
  it('extracts title, description, and grouped page entries', () => {
    const idx = parseLlmsIndex(SAMPLE_LLMS_TXT);
    expect(idx.title).toBe('Kombo');
    expect(idx.description).toBe('One unified API for HRIS and ATS integrations.');
    expect(idx.pages).toHaveLength(4);
    expect(idx.pages[0]).toEqual({
      title: 'Introduction',
      path: '/introduction',
      section: 'Get Started',
      description: 'What Kombo does and how it fits.',
    });
    expect(idx.pages[3]).toEqual({
      title: 'Employees',
      path: '/api-reference/employees',
      section: 'API Reference',
    });
  });

  it('converts absolute URLs back to site-relative paths (legacy: no baseUrl)', () => {
    const idx = parseLlmsIndex(`
# X

## Section
- [Foo](https://docs.example.com/foo)
- [Bar](https://other.example.com/external)
- [Baz](relative)
`);
    expect(idx.pages.map((p) => p.path)).toEqual(['/foo', '/external', '/relative']);
  });

  it('drops cross-origin links when baseUrl is provided', () => {
    // Real-world example: docs.kombo.dev's llms.txt links to changelog
    // and status subdomains. Fetching those as <baseUrl><path>.md 404s
    // at best and TLS-handshake-fails at worst — they belong on other hosts.
    const idx = parseLlmsIndex(
      `
# Site

## Section
- [Internal](https://docs.example.com/internal)
- [Changelog](https://changelog.example.com/v1.2)
- [Status](https://status.example.com/)
- [Relative](/foo)
`,
      'https://docs.example.com',
    );
    expect(idx.pages.map((p) => p.path)).toEqual(['/internal', '/foo']);
  });

  it('strips trailing `.md` from hrefs (Kombo-style llms.txt)', () => {
    // Some Mintlify sites ship llms.txt with the .md suffix already in the
    // link target. The path needs to be the canonical page URL so
    // fetchPageMarkdown can re-append .md without producing /foo.md.md.
    const idx = parseLlmsIndex(`
# X

## Section
- [Foo](https://docs.example.com/foo.md): desc
- [Bar](/bar.md)
`);
    expect(idx.pages.map((p) => p.path)).toEqual(['/foo', '/bar']);
  });

  it('returns empty pages list on a doc with no bullets', () => {
    const idx = parseLlmsIndex('# Just a title\n\n> A description');
    expect(idx.pages).toEqual([]);
  });
});

describe('createMintlifySpec', () => {
  it('declares two resources (pages + openapi) and `none` auth', () => {
    const spec = createMintlifySpec();
    expect(spec.id).toBe('mintlify');
    expect(spec.resources).toHaveLength(2);
    expect(spec.resources.map((r) => r.id)).toEqual(['pages', 'openapi']);
    expect(spec.auth.kind).toBe('none');
    expect(spec.auth.refreshable).toBe(false);
  });
});

describe('Mintlify sync — pages', () => {
  it('fetches /llms.txt then per-page .md and emits one chunk batch per page', async () => {
    const { fetchImpl, calls } = makeFetch((url) => {
      if (url.endsWith('/llms.txt')) return { body: SAMPLE_LLMS_TXT };
      if (url.endsWith('/introduction.md')) {
        return { body: '# Introduction\n\nKombo is a unified HRIS API.' };
      }
      if (url.endsWith('/quickstart.md')) {
        return { body: '# Quickstart\n\nMake your first call.' };
      }
      if (url.endsWith('/authentication.md')) {
        return { body: '# Authentication\n\nUse a bearer token.' };
      }
      if (url.endsWith('/employees.md')) {
        return { body: '# Employees\n\nList all employees.' };
      }
      // OpenAPI probe — return 404 for all conventional paths.
      return { status: 404, body: '' };
    });

    const spec = createMintlifySpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: { baseUrl: 'https://docs.example.com' },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(4);
    // One chunk batch per page.
    const pageKinds = new Set(enqueued.map((c) => c.kind));
    expect(pageKinds.has('mintlify-page')).toBe(true);
    // Source-artifact id keyed on the page URL.
    const ids = new Set(enqueued.map((c) => c.sourceArtifactId));
    expect(ids.has('mintlify-page:https://docs.example.com/introduction')).toBe(true);
    expect(ids.has('mintlify-page:https://docs.example.com/api-reference/employees')).toBe(true);

    // Cursor stores per-page hashes.
    const last = savedCursors.find((s) => s.resourceId === 'pages')?.cursor as {
      pageHashes: Record<string, string>;
    };
    expect(Object.keys(last.pageHashes)).toContain('/introduction');
    expect(Object.keys(last.pageHashes)).toContain('/api-reference/employees');

    // /llms.txt fetched exactly once.
    const indexFetches = calls.filter((c) => c.url.endsWith('/llms.txt'));
    expect(indexFetches).toHaveLength(1);
  });

  it('skips pages whose markdown hash matches the cursor (incremental)', async () => {
    const introMarkdown = '# Introduction\n\nKombo is a unified HRIS API.';
    // SHA256 hash of introMarkdown — pre-computed at runtime for the test.
    const { createHash } = await import('node:crypto');
    const introHash = createHash('sha256').update(introMarkdown).digest('hex');

    const fetched: string[] = [];
    const { fetchImpl } = makeFetch((url) => {
      fetched.push(url);
      if (url.endsWith('/llms.txt')) {
        // Single-entry index for simplicity.
        return {
          body: '# X\n\n## Section\n\n- [Introduction](/introduction)\n',
        };
      }
      if (url.endsWith('/introduction.md')) return { body: introMarkdown };
      return { status: 404, body: '' };
    });

    const spec = createMintlifySpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { pages: { pageHashes: { '/introduction': introHash } } },
      sourceMetadata: { baseUrl: 'https://docs.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    // The page WAS fetched (hash compare happens after fetch) but no chunks
    // were emitted because the hash matched.
    expect(fetched.some((u) => u.endsWith('/introduction.md'))).toBe(true);
    expect(enqueued).toHaveLength(0);
  });
});

describe('Mintlify sync — openapi', () => {
  it('emits one chunk per (path, method) when an OpenAPI spec is found', async () => {
    const openapi = {
      openapi: '3.0.0',
      info: { title: 'Demo API', version: '1.0' },
      paths: {
        '/users': {
          get: { summary: 'List users', responses: { '200': { description: 'OK' } } },
          post: {
            summary: 'Create user',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    };

    const { fetchImpl } = makeFetch((url) => {
      if (url.endsWith('/llms.txt')) {
        return { body: '# X\n\n' };
      }
      if (url.endsWith('/openapi.json')) {
        return { body: JSON.stringify(openapi) };
      }
      return { status: 404, body: '' };
    });

    const spec = createMintlifySpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: { baseUrl: 'https://docs.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const endpoints = enqueued.filter((c) => c.kind === 'mintlify-openapi-endpoint');
    expect(endpoints).toHaveLength(2);
    const ids = new Set(endpoints.map((c) => c.metadata['method']));
    expect(ids.has('GET')).toBe(true);
    expect(ids.has('POST')).toBe(true);

    // Cursor stores spec hash.
    const openapiCursor = savedCursors.find((s) => s.resourceId === 'openapi')?.cursor as {
      specHash?: string;
    };
    expect(openapiCursor.specHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('silently no-ops when no OpenAPI spec is found at the conventional paths', async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (url.endsWith('/llms.txt')) return { body: '# X\n\n' };
      return { status: 404, body: '' };
    });
    const spec = createMintlifySpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      sourceMetadata: { baseUrl: 'https://docs.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued.filter((c) => c.kind === 'mintlify-openapi-endpoint')).toHaveLength(0);
  });
});

describe('Mintlify spec — error paths', () => {
  it('throws HOLO_INVALID_INPUT when sources.metadata.baseUrl is missing', async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 200, body: '' }));
    const spec = createMintlifySpec({ fetchImpl });
    const { stores } = makeStores({ sourceMetadata: {} });
    await expect(
      runConnectorSync({
        spec,
        stores,
        organizationId: 'o',
        sourceId: 's',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });
});
