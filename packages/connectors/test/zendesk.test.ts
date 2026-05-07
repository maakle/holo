import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { stripHtmlToText } from '@holo/chunker';
import { createZendeskSpec } from '../src/zendesk/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
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
        return new Set<string>();
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
      async loadSourceMetadata() {
        return initial?.sourceMetadata ?? { baseUrl: 'https://help.example.com' };
      },
    },
  };
}

interface CapturedRequest {
  url: string;
}

function makeFetch(
  responder: (url: string) => unknown,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown) => {
    const u = String(url);
    calls.push({ url: u });
    return jsonResponse(responder(u));
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

function makeArticle(partial: {
  id: number;
  title: string;
  updatedAt: string;
  body?: string;
  sectionId?: number | null;
  draft?: boolean;
  outdated?: boolean;
}): unknown {
  return {
    id: partial.id,
    url: `https://help.example.com/api/v2/help_center/articles/${partial.id}.json`,
    html_url: `https://help.example.com/hc/en-us/articles/${partial.id}-foo`,
    locale: 'en-us',
    source_locale: 'en-us',
    title: partial.title,
    body: partial.body ?? `<p>${partial.title}</p>`,
    section_id: partial.sectionId ?? null,
    author_id: 1,
    outdated: partial.outdated ?? false,
    draft: partial.draft ?? false,
    updated_at: partial.updatedAt,
    created_at: partial.updatedAt,
    vote_sum: 1,
    vote_count: 1,
  };
}

describe('stripHtmlToText', () => {
  it('preserves headings as markdown and inlines link URLs', () => {
    const html = '<h1>Title</h1><p>See <a href="https://x.com">our docs</a>.</p>';
    const text = stripHtmlToText(html);
    expect(text).toContain('# Title');
    expect(text).toContain('our docs (https://x.com)');
  });

  it('drops script and style tags entirely', () => {
    const html = '<p>Hi</p><script>alert(1)</script><style>body{}</style>';
    const text = stripHtmlToText(html);
    expect(text).toBe('Hi');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtmlToText('<p>Foo &amp; bar &nbsp; baz</p>')).toBe('Foo & bar   baz');
  });

  it('renders <li> bullets as a markdown list', () => {
    const html = '<ul><li>One</li><li>Two</li></ul>';
    const text = stripHtmlToText(html);
    expect(text).toContain('- One');
    expect(text).toContain('- Two');
  });
});

describe('createZendeskSpec', () => {
  it('declares one resource and `none` auth', () => {
    const spec = createZendeskSpec();
    expect(spec.id).toBe('zendesk');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('articles');
    expect(spec.auth.kind).toBe('none');
    expect(spec.auth.refreshable).toBe(false);
  });
});

describe('Zendesk sync — articles', () => {
  it('fetches sections + categories + paginated articles and emits chunks', async () => {
    const { fetchImpl, calls } = makeFetch((url) => {
      if (url.includes('/help_center/sections.json')) {
        return {
          sections: [{ id: 10, name: 'Getting Started', category_id: 100, locale: 'en-us', html_url: '' }],
          next_page: null,
        };
      }
      if (url.includes('/help_center/categories.json')) {
        return {
          categories: [{ id: 100, name: 'Product', locale: 'en-us', html_url: '' }],
          next_page: null,
        };
      }
      if (url.includes('/help_center/articles.json')) {
        // Single page response.
        return {
          articles: [
            makeArticle({
              id: 1,
              title: 'How to start',
              updatedAt: '2026-05-01T10:00:00Z',
              sectionId: 10,
              body: '<h1>Welcome</h1><p>Start here.</p>',
            }),
            makeArticle({
              id: 2,
              title: 'Advanced topics',
              updatedAt: '2026-05-02T10:00:00Z',
              sectionId: 10,
            }),
          ],
          next_page: null,
        };
      }
      return null;
    });

    const spec = createZendeskSpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      sourceMetadata: { baseUrl: 'https://help.example.com' },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(2);
    expect(enqueued[0]!.kind).toBe('zendesk-article');
    // Source-artifact id keyed on article id under the help-center URL.
    expect(enqueued[0]!.sourceArtifactId).toBe(
      'zendesk-article:https://help.example.com:1',
    );
    // Breadcrumb attached: Category / Section / Title.
    expect(enqueued[0]!.content).toContain('Product / Getting Started / How to start');
    // Cursor advances to highest updated_at as Unix seconds.
    const cursor = savedCursors.at(-1)?.cursor as { updatedAt?: number };
    const expectedTs = Math.floor(new Date('2026-05-02T10:00:00Z').getTime() / 1000);
    expect(cursor.updatedAt).toBe(expectedTs);

    // Verify the public articles endpoint was called sorted newest-first.
    const articles = calls.find((c) => c.url.includes('/help_center/articles.json'));
    expect(articles?.url).toContain('sort_by=updated_at');
    expect(articles?.url).toContain('sort_order=desc');
  });

  it('stops paging once articles cross the stored cursor', async () => {
    let articlesPage = 0;
    const { fetchImpl } = makeFetch((url) => {
      if (url.includes('/sections.json')) return { sections: [], next_page: null };
      if (url.includes('/categories.json')) return { categories: [], next_page: null };
      if (url.includes('/help_center/articles.json')) {
        articlesPage += 1;
        if (articlesPage === 1) {
          return {
            articles: [
              // Newer than cursor (2025-01-01 = 1735689600) → kept
              makeArticle({ id: 1, title: 'Fresh', updatedAt: '2026-05-01T10:00:00Z' }),
              // Older than cursor → triggers early-exit
              makeArticle({ id: 2, title: 'Stale', updatedAt: '2024-01-01T10:00:00Z' }),
            ],
            next_page: 'https://help.example.com/api/v2/help_center/articles.json?page=2',
          };
        }
        // Should never be hit — we stopped paging.
        return { articles: [makeArticle({ id: 3, title: 'NeverSeen', updatedAt: '2026-06-01T10:00:00Z' })], next_page: null };
      }
      return null;
    });
    const spec = createZendeskSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { articles: { updatedAt: 1735689600 } },
      sourceMetadata: { baseUrl: 'https://help.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued).toHaveLength(1);
    expect(articlesPage).toBe(1);
  });

  it('skips drafts and outdated articles (no chunks emitted)', async () => {
    const { fetchImpl } = makeFetch((url) => {
      if (url.includes('/sections.json')) return { sections: [], next_page: null };
      if (url.includes('/categories.json')) return { categories: [], next_page: null };
      if (url.includes('/help_center/articles.json')) {
        return {
          articles: [
            makeArticle({ id: 1, title: 'Draft', updatedAt: '2026-05-01T10:00:00Z', draft: true }),
            makeArticle({ id: 2, title: 'Outdated', updatedAt: '2026-05-01T10:00:00Z', outdated: true }),
          ],
          next_page: null,
        };
      }
      return null;
    });
    const spec = createZendeskSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      sourceMetadata: { baseUrl: 'https://help.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued).toHaveLength(0);
  });

  it('walks paginated public-listing responses (next_page)', async () => {
    let articlesPage = 0;
    const { fetchImpl } = makeFetch((url) => {
      if (url.includes('/sections.json')) return { sections: [], next_page: null };
      if (url.includes('/categories.json')) return { categories: [], next_page: null };
      if (url.includes('/help_center/articles.json')) {
        articlesPage += 1;
        if (articlesPage === 1) {
          return {
            articles: [makeArticle({ id: 1, title: 'A', updatedAt: '2026-05-01T10:00:00Z' })],
            next_page: 'https://help.example.com/api/v2/help_center/articles.json?page=2',
          };
        }
        return {
          articles: [makeArticle({ id: 2, title: 'B', updatedAt: '2026-05-02T10:00:00Z' })],
          next_page: null,
        };
      }
      return null;
    });
    const spec = createZendeskSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      sourceMetadata: { baseUrl: 'https://help.example.com' },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued.length).toBe(2);
    expect(articlesPage).toBe(2);
  });

  it('throws HOLO_INVALID_INPUT when sources.metadata.baseUrl is missing', async () => {
    const { fetchImpl } = makeFetch(() => ({}));
    const spec = createZendeskSpec({ fetchImpl });
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
