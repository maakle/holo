import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import {
  createPrismicSpec,
  documentToMarkdown,
  isValidRepoName,
  parseRepoInput,
  richTextToMarkdown,
} from '../src/prismic/index';
import type { PrismicDocument } from '../src/prismic/types';

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
        return initial?.sourceMetadata ?? { repo: 'beglaubigt' };
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  authorization?: string;
}

function makeFetch(
  responder: (url: string) => { status?: number; body: string } | null,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const captured: CapturedRequest = {
      url: u,
      method: (init?.method ?? 'GET').toUpperCase(),
    };
    if (headers['Authorization']) captured.authorization = headers['Authorization'];
    calls.push(captured);
    const resp = responder(u);
    if (!resp) return new Response('', { status: 404 });
    return new Response(resp.body, {
      status: resp.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

function makeDoc(overrides: Partial<PrismicDocument> = {}): PrismicDocument {
  return {
    id: 'Y-x1abcd',
    uid: 'how-it-works',
    type: 'faq',
    lang: 'de-de',
    href: 'https://beglaubigt.cdn.prismic.io/api/v2/documents/...',
    last_publication_date: '2026-04-30T12:00:00.000Z',
    first_publication_date: '2026-01-01T00:00:00.000Z',
    tags: ['public'],
    data: {
      question: [
        { type: 'heading2', text: 'Wie funktioniert die Beglaubigung?', spans: [] },
      ],
      answer: [
        { type: 'paragraph', text: 'Sie laden ein Dokument hoch.', spans: [] },
        { type: 'paragraph', text: 'Wir prüfen es.', spans: [] },
      ],
    },
    ...overrides,
  };
}

const REPO_RESPONSE = {
  refs: [
    { id: 'master', ref: 'ref-1', label: 'Master', isMasterRef: true },
  ],
  types: { faq: 'FAQ', page: 'Page' },
  languages: [{ id: 'de-de', name: 'German' }],
};

function searchResponse(docs: PrismicDocument[], totalPages = 1, page = 1) {
  return {
    page,
    results_per_page: 100,
    results_size: docs.length,
    total_results_size: docs.length,
    total_pages: totalPages,
    next_page: page < totalPages ? 'next' : null,
    prev_page: page > 1 ? 'prev' : null,
    results: docs,
  };
}

describe('isValidRepoName / parseRepoInput', () => {
  it('accepts simple slugs', () => {
    expect(isValidRepoName('beglaubigt')).toBe(true);
    expect(isValidRepoName('my-repo-1')).toBe(true);
  });
  it('rejects malformed names', () => {
    expect(isValidRepoName('-leading')).toBe(false);
    expect(isValidRepoName('trailing-')).toBe(false);
    expect(isValidRepoName('UPPER')).toBe(false);
    expect(isValidRepoName('with.dot')).toBe(false);
    expect(isValidRepoName('')).toBe(false);
  });
  it('extracts the slug from full Prismic URLs', () => {
    expect(parseRepoInput('https://beglaubigt.prismic.io')).toBe('beglaubigt');
    expect(parseRepoInput('https://beglaubigt.cdn.prismic.io/api/v2')).toBe('beglaubigt');
  });
  it('returns null for unrelated hosts', () => {
    expect(parseRepoInput('https://example.com/foo')).toBeNull();
  });
});

describe('richTextToMarkdown', () => {
  it('renders headings, paragraphs, lists, and preformatted blocks', () => {
    const md = richTextToMarkdown([
      { type: 'heading1', text: 'Title' },
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'list-item', text: 'one' },
      { type: 'list-item', text: 'two' },
      { type: 'o-list-item', text: 'numbered' },
      { type: 'preformatted', text: 'const x = 1;' },
    ]);
    expect(md).toContain('# Title');
    expect(md).toContain('First paragraph.');
    expect(md).toContain('- one');
    expect(md).toContain('1. numbered');
    expect(md).toContain('```\nconst x = 1;\n```');
  });
});

describe('documentToMarkdown', () => {
  it('flattens slice zones and rich-text fields into a single body', () => {
    const doc = makeDoc();
    const md = documentToMarkdown(doc);
    expect(md).toContain('Wie funktioniert die Beglaubigung?');
    expect(md).toContain('Sie laden ein Dokument hoch.');
    expect(md).toContain('Wir prüfen es.');
  });

  it('walks slices and includes alt text from images', () => {
    const doc = makeDoc({
      data: {
        body: [
          {
            slice_type: 'hero',
            primary: {
              heading: [{ type: 'heading1', text: 'Welcome' }],
              illustration: {
                url: 'https://images.example.com/hero.png',
                alt: 'A friendly diagram',
                dimensions: { width: 100, height: 100 },
              },
            },
            items: [],
          },
        ],
      },
    });
    const md = documentToMarkdown(doc);
    expect(md).toContain('Welcome');
    expect(md).toContain('A friendly diagram');
  });

  it('drops link / content-relationship fields', () => {
    const doc = makeDoc({
      data: {
        related: { link_type: 'Document', id: 'X', slug: 'something', isBroken: false },
        title: [{ type: 'heading1', text: 'Title' }],
      },
    });
    const md = documentToMarkdown(doc);
    expect(md).toContain('Title');
    expect(md).not.toContain('slug');
  });
});

describe('createPrismicSpec', () => {
  it('declares one `documents` resource and `none` auth', () => {
    const spec = createPrismicSpec();
    expect(spec.id).toBe('prismic');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('documents');
    expect(spec.auth.kind).toBe('none');
  });
});

describe('Prismic sync — documents', () => {
  it('fetches /api/v2 then pages /documents/search and emits one chunk batch per doc', async () => {
    const docs = [makeDoc({ id: 'a', uid: 'a' }), makeDoc({ id: 'b', uid: 'b' })];
    const { fetchImpl, calls } = makeFetch((url) => {
      if (url.endsWith('/api/v2')) return { body: JSON.stringify(REPO_RESPONSE) };
      if (url.includes('/documents/search')) {
        return { body: JSON.stringify(searchResponse(docs)) };
      }
      return { status: 404, body: '' };
    });

    const spec = createPrismicSpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: { repo: 'beglaubigt' },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(2);
    const kinds = new Set(enqueued.map((c) => c.kind));
    expect(kinds.has('prismic-document')).toBe(true);
    const ids = new Set(enqueued.map((c) => c.sourceArtifactId));
    expect(ids.has('prismic-document:beglaubigt:a')).toBe(true);
    expect(ids.has('prismic-document:beglaubigt:b')).toBe(true);

    const last = savedCursors.find((s) => s.resourceId === 'documents')?.cursor as {
      lastRef?: string;
      lastSyncedAt?: string;
    };
    expect(last.lastRef).toBe('ref-1');
    expect(last.lastSyncedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // /api/v2 fetched exactly once.
    const meta = calls.filter((c) => c.url.endsWith('/api/v2'));
    expect(meta).toHaveLength(1);
  });

  it('short-circuits when the master ref matches the cursor (no document fetches)', async () => {
    let searchCalls = 0;
    const { fetchImpl } = makeFetch((url) => {
      if (url.endsWith('/api/v2')) return { body: JSON.stringify(REPO_RESPONSE) };
      if (url.includes('/documents/search')) {
        searchCalls += 1;
        return { body: JSON.stringify(searchResponse([makeDoc()])) };
      }
      return { status: 404, body: '' };
    });

    const spec = createPrismicSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { documents: { lastRef: 'ref-1', lastSyncedAt: '2026-04-01T00:00:00.000Z' } },
      sourceMetadata: { repo: 'beglaubigt' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    expect(searchCalls).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it('passes the previous lastSyncedAt as a date.after predicate', async () => {
    const seen: string[] = [];
    const { fetchImpl } = makeFetch((url) => {
      seen.push(url);
      if (url.endsWith('/api/v2')) {
        return {
          body: JSON.stringify({
            ...REPO_RESPONSE,
            refs: [{ id: 'master', ref: 'ref-2', label: 'Master', isMasterRef: true }],
          }),
        };
      }
      if (url.includes('/documents/search')) {
        return { body: JSON.stringify(searchResponse([makeDoc({ id: 'new' })])) };
      }
      return { status: 404, body: '' };
    });

    const spec = createPrismicSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { documents: { lastRef: 'ref-1', lastSyncedAt: '2026-04-01T00:00:00.000Z' } },
      sourceMetadata: { repo: 'beglaubigt' },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

    const searchUrl = seen.find((u) => u.includes('/documents/search'))!;
    expect(searchUrl).toContain('date.after');
    expect(searchUrl).toContain('2026-04-01T00%3A00%3A00Z');
    expect(searchUrl).not.toMatch(/\.\d+Z/);
    expect(enqueued.length).toBeGreaterThan(0);
  });

  it('sends Authorization: Token <pat> when accessToken is in source metadata', async () => {
    const { fetchImpl, calls } = makeFetch((url) => {
      if (url.endsWith('/api/v2')) return { body: JSON.stringify(REPO_RESPONSE) };
      if (url.includes('/documents/search')) {
        return { body: JSON.stringify(searchResponse([])) };
      }
      return { status: 404, body: '' };
    });

    const spec = createPrismicSpec({ fetchImpl });
    const { stores } = makeStores({
      sourceMetadata: { repo: 'beglaubigt', accessToken: 'pat_abc' },
    });
    await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

    const authed = calls.filter((c) => c.authorization === 'Token pat_abc');
    expect(authed.length).toBeGreaterThan(0);
  });

  it('throws HOLO_INVALID_INPUT when sources.metadata.repo is missing or malformed', async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 200, body: '{}' }));
    const spec = createPrismicSpec({ fetchImpl });
    const { stores } = makeStores({ sourceMetadata: {} });
    await expect(
      runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });
});
