import { describe, it, expect, vi } from 'vitest';
import { runNotionSync, computeNotionCoverage, type RunNotionSyncInput } from '../../src/notion/sync';
import type { NotionApiClient, NotionPage, NotionBlock } from '../../src/notion/api-client';

function mockPage(id: string, overrides: Partial<NotionPage> = {}): NotionPage {
  return {
    id,
    archived: false,
    last_edited_time: '2026-04-01T00:00:00.000Z',
    last_edited_by: { id: 'user-1' },
    parent: { type: 'workspace', workspace: true },
    properties: {
      Name: { type: 'title', title: [{ plain_text: `Page ${id}` }] },
    },
    ...overrides,
  };
}

function mockBlock(id: string, type: string, text = ''): NotionBlock {
  return {
    id,
    type,
    has_children: false,
    [type]: { rich_text: [{ plain_text: text }] },
  };
}

function mockClient(overrides: Partial<NotionApiClient> = {}): NotionApiClient {
  return {
    pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1')),
    blocksChildrenList: vi.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
    databasesQuery: vi.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
    search: vi.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
    usersMe: vi.fn().mockResolvedValue({ id: 'user-1', workspace_name: 'Acme' }),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunNotionSyncInput> = {}): RunNotionSyncInput {
  return {
    client: mockClient(),
    allowedPageIds: ['page-1'],
    cursorMetadata: {},
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runNotionSync', () => {
  it('chunks a page with blocks and enqueues embed job', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1')),
      blocksChildrenList: vi.fn().mockResolvedValue({
        results: [
          mockBlock('b1', 'paragraph', 'Hello world from Notion'),
          mockBlock('b2', 'paragraph', 'Second block'),
        ],
        nextCursor: undefined,
      }),
    });

    const result = await runNotionSync(baseInput({ client, enqueueEmbed }));

    expect(result.artifactCount).toBeGreaterThan(0);
    expect(enqueueEmbed).toHaveBeenCalled();
    const chunks = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0].chunks;
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].kind).toBe('notion-page');
  });

  it('skips archived pages', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1', { archived: true })),
    });
    const result = await runNotionSync(baseInput({ client, enqueueEmbed }));
    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('incremental: skips page with unchanged last_edited_time', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const ts = '2026-04-01T00:00:00.000Z';
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1', { last_edited_time: ts })),
      blocksChildrenList: vi.fn().mockResolvedValue({ results: [], nextCursor: undefined }),
    });
    const result = await runNotionSync(
      baseInput({
        client,
        enqueueEmbed,
        cursorMetadata: { last_edited_per_page: { 'page-1': ts } },
      }),
    );
    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('incremental: re-chunks page when last_edited_time changed', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(
        mockPage('page-1', { last_edited_time: '2026-04-02T00:00:00.000Z' }),
      ),
      blocksChildrenList: vi.fn().mockResolvedValue({
        results: [mockBlock('b1', 'paragraph', 'Updated content')],
        nextCursor: undefined,
      }),
    });
    const result = await runNotionSync(
      baseInput({
        client,
        enqueueEmbed,
        cursorMetadata: { last_edited_per_page: { 'page-1': '2026-04-01T00:00:00.000Z' } },
      }),
    );
    expect(result.artifactCount).toBeGreaterThan(0);
    expect(enqueueEmbed).toHaveBeenCalled();
  });

  it('records last_edited_time in updatedMetadata for each processed page', async () => {
    const ts = '2026-04-01T12:00:00.000Z';
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1', { last_edited_time: ts })),
      blocksChildrenList: vi.fn().mockResolvedValue({
        results: [mockBlock('b1', 'paragraph', 'content')],
        nextCursor: undefined,
      }),
    });
    const result = await runNotionSync(baseInput({ client }));
    const meta = result.updatedMetadata['last_edited_per_page'] as Record<string, string>;
    expect(meta['page-1']).toBe(ts);
  });

  it('deduplicates chunks present in existingHashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      pagesRetrieve: vi.fn().mockResolvedValue(mockPage('page-1')),
      blocksChildrenList: vi.fn().mockResolvedValue({
        results: [mockBlock('b1', 'paragraph', 'same content')],
        nextCursor: undefined,
      }),
    });
    // First run to get the hash
    const r1 = await runNotionSync(baseInput({ client, enqueueEmbed }));
    expect(r1.artifactCount).toBeGreaterThan(0);

    const chunks = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0].chunks as Array<{ contentHash: string }>;
    const existingHashes = new Set(chunks.map((c) => c.contentHash));

    const r2 = await runNotionSync(baseInput({ client, enqueueEmbed: vi.fn(), existingHashes }));
    expect(r2.artifactCount).toBe(0);
  });

  it('handles 404 page gracefully (log + skip)', async () => {
    const warnings: unknown[] = [];
    const client = mockClient({
      pagesRetrieve: vi.fn().mockRejectedValue(Object.assign(new Error('404'), { status: 404 })),
    });
    const result = await runNotionSync(
      baseInput({ client, logger: { warn: (o) => warnings.push(o) } }),
    );
    expect(result.artifactCount).toBe(0);
    expect(warnings.some((w) => (w as { code: string }).code === 'HOLO_NOTION_PAGE_NOT_FOUND')).toBe(true);
  });

  it('throws HOLO_NOTION_TOKEN_INVALID on 401', async () => {
    const client = mockClient({
      pagesRetrieve: vi.fn().mockRejectedValue(Object.assign(new Error('401'), { status: 401 })),
    });
    await expect(runNotionSync(baseInput({ client }))).rejects.toMatchObject({
      code: 'HOLO_NOTION_TOKEN_INVALID',
    });
  });

  it('throws HOLO_ALLOWLIST_EMPTY when no pages provided', async () => {
    await expect(runNotionSync(baseInput({ allowedPageIds: [] }))).rejects.toMatchObject({
      code: 'HOLO_ALLOWLIST_EMPTY',
    });
  });
});

describe('computeNotionCoverage', () => {
  it('returns correct counts: shared pages, allowlist intersection, reachable children', async () => {
    const sharedPages = [
      mockPage('p1'),
      mockPage('p2'),
      mockPage('p3'),
      mockPage('p4'),
      mockPage('p5'),
    ];
    const client = mockClient({
      search: vi.fn().mockResolvedValue({ results: sharedPages, nextCursor: undefined }),
      // p1 has 3 child pages, p3 has 2, p5 has 0 (only p1,p3 are in allowlist)
      blocksChildrenList: vi.fn().mockImplementation((blockId: string) => {
        if (blockId === 'p1') {
          return Promise.resolve({
            results: [
              { id: 'c1', type: 'child_page', has_children: false },
              { id: 'c2', type: 'child_page', has_children: false },
            ],
            nextCursor: undefined,
          });
        }
        if (blockId === 'p3') {
          return Promise.resolve({
            results: [{ id: 'c3', type: 'child_page', has_children: false }],
            nextCursor: undefined,
          });
        }
        return Promise.resolve({ results: [], nextCursor: undefined });
      }),
    });

    const result = await computeNotionCoverage(client, ['p1', 'p3', 'p9', 'p10']);
    // 5 total shared, 2 in allowlist intersection (p1, p3), p1→3 (self+2 children), p3→2 (self+1 child)
    expect(result.sharedRootPageCount).toBe(5);
    expect(result.allowlistedRootPageCount).toBe(2);
    expect(result.reachableChildPageCount).toBe(5); // p1 (1+2) + p3 (1+1)
    expect(result.shareMoreUrl).toBe('https://www.notion.so/my-integrations');
  });
});

describe('createNotionConnector', () => {
  it('testConnection returns workspace identity', async () => {
    const { createNotionConnector } = await import('../../src/notion/index');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-1', workspace_name: 'Acme' }), { status: 200 }),
    );
    const c = createNotionConnector({ fetchImpl });
    const result = await c.testConnection({ accessToken: 'secret' });
    expect(result).toMatchObject({ ok: true, name: 'Acme' });
  });

  it('testConnection throws HOLO_NOTION_TOKEN_INVALID on 401', async () => {
    const { createNotionConnector } = await import('../../src/notion/index');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    const c = createNotionConnector({ fetchImpl });
    await expect(c.testConnection({ accessToken: 'bad' })).rejects.toMatchObject({
      code: 'HOLO_NOTION_TOKEN_INVALID',
    });
  });
});
