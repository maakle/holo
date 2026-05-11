import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createJiraSpec } from '../../src/jira';
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
    // Normalize Headers instance → plain object so tests can use bracket notation.
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

function makeIssuesCtx(opts: { siteUrl: string; cursor?: { updatedAt?: string } }) {
  const upserts: ChunkUpsert[] = [];
  const flushed: Array<{ updatedAt?: string }> = [];
  const ctx: ResourceSyncContext<{ updatedAt?: string }> = {
    organizationId: 'org-1',
    sourceId: 'src-1',
    tokens: { accessToken: 'Zm9vQGV4YW1wbGUuY29tOnRva2Vu' }, // foo@example.com:token (base64)
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

describe('createJiraSpec', () => {
  it('declares id="jira", apiKey Basic auth, and two resources', () => {
    const spec = createJiraSpec();
    expect(spec.id).toBe('jira');
    expect(spec.displayName).toBe('Jira');
    expect(spec.auth.kind).toBe('apiKey');
    expect(spec.resources.map((r) => r.id).sort()).toEqual(['issues', 'projects']);
  });

  it('issues sync paginates with nextPageToken, emits issue + comment chunks, advances cursor', async () => {
    const page1 = await loadFixture('issues-page-1.json');
    const page2 = await loadFixture('issues-page-2.json');

    const { fetchImpl, calls } = makeMockFetch([
      async (url, init) => {
        if (!url.endsWith('/rest/api/3/search/jql')) return null;
        const body = JSON.parse((init.body as string) ?? '{}');
        return body.nextPageToken
          ? jsonResponse(page2)
          : jsonResponse(page1);
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const { ctx, upserts, flushed } = makeIssuesCtx({ siteUrl: 'https://acme.atlassian.net' });

    const finalCursor = await issuesResource.sync(ctx);

    // Two issues on page 1 (one with a comment) + one issue on page 2 = 3 issues + 1 comment.
    const kinds = upserts.map((u) => u.kind);
    expect(kinds.filter((k) => k === 'jira-issue')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'jira-comment')).toHaveLength(1);

    // Cursor watermark = max(updated) across all issues — page 2's OPS-1 was updated 2026-05-10.
    expect(finalCursor.updatedAt).toBe('2026-05-10T08:00:00.000+0000');
    // Per-page checkpoint: at least one flush after page 1 + one after page 2.
    expect(flushed.length).toBeGreaterThanOrEqual(2);

    // Hits acme.atlassian.net per-tenant URL, not the placeholder.
    expect(calls[0].url.startsWith('https://acme.atlassian.net/')).toBe(true);

    // First request carries Authorization: Basic <token>.
    const authHeader =
      (calls[0].init.headers as Record<string, string>)['Authorization'] ??
      (calls[0].init.headers as Record<string, string>)['authorization'];
    expect(authHeader).toBe('Basic Zm9vQGV4YW1wbGUuY29tOnRva2Vu');
  });

  it('issues sync resumes from cursor.updatedAt with a JQL "updated >=" filter', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/rest/api/3/search/jql')) return null;
        return jsonResponse({ issues: [], isLast: true });
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const { ctx } = makeIssuesCtx({
      siteUrl: 'https://acme.atlassian.net',
      cursor: { updatedAt: '2026-05-09T15:22:00.000+0000' },
    });

    await issuesResource.sync(ctx);
    const body = JSON.parse((calls[0].init.body as string) ?? '{}');
    expect(body.jql).toContain('updated >= "2026-05-09T15:22:00.000+0000"');
    expect(body.jql).toContain('ORDER BY updated ASC');
  });

  it('projects sync emits one chunk per project from a single page', async () => {
    const projects = await loadFixture('projects-page-1.json');
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.includes('/rest/api/3/project/search')) return null;
        return jsonResponse(projects);
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const projectsResource = spec.resources.find((r) => r.id === 'projects')!;
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

    await projectsResource.sync(ctx);
    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.kind === 'jira-project')).toBe(true);
    expect(upserts.map((u) => u.metadata.key)).toEqual(['ENG', 'OPS']);
  });

  it('throws HOLO_INVALID_INPUT if sources.metadata.siteUrl is missing (issues)', async () => {
    const spec = createJiraSpec({ fetchImpl: async () => jsonResponse({}) });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
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

    await expect(issuesResource.sync(ctx)).rejects.toMatchObject({
      code: 'HOLO_INVALID_INPUT',
    });
  });

  it('throws HOLO_INVALID_INPUT if sources.metadata.siteUrl is missing (projects)', async () => {
    const spec = createJiraSpec({ fetchImpl: async () => jsonResponse({}) });
    const projectsResource = spec.resources.find((r) => r.id === 'projects')!;
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
    } as ResourceSyncContext<unknown>;

    await expect(projectsResource.sync(ctx)).rejects.toMatchObject({
      code: 'HOLO_INVALID_INPUT',
    });
  });

  it('aborts mid-page when ctx.signal fires', async () => {
    const page1 = await loadFixture('issues-page-1.json');
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/rest/api/3/search/jql')) return null;
        return jsonResponse(page1);
      },
    ]);
    const spec = createJiraSpec({ fetchImpl });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const controller = new AbortController();
    // Abort as soon as the first chunk is upserted — we should not see
    // the second issue processed.
    let upsertCount = 0;
    const ctx: ResourceSyncContext<{ updatedAt?: string }> = {
      organizationId: 'org-1',
      sourceId: 'src-1',
      tokens: { accessToken: 'x' },
      api: {} as ResourceSyncContext<unknown>['api'],
      paginate: {} as ResourceSyncContext<unknown>['paginate'],
      cursor: {},
      allowlist: [],
      sourceMetadata: { siteUrl: 'https://acme.atlassian.net' },
      signal: controller.signal,
      async upsert() {
        upsertCount += 1;
        controller.abort();
      },
      async flushCursor() {},
    };

    await expect(issuesResource.sync(ctx)).rejects.toThrow();
    // First issue's upsert ran (issue chunk), then abort fired, then the
    // loop's throwIfAborted halted the rest. Comment + second issue should
    // not have been processed.
    expect(upsertCount).toBeLessThan(3);
  });

  it('testConnection issues GET /rest/api/3/myself and returns accountId as externalId', async () => {
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/rest/api/3/myself')) return null;
        return jsonResponse({
          accountId: 'u-jane',
          displayName: 'Jane Doe',
          emailAddress: 'jane@acme.test',
        });
      },
    ]);
    const spec = createJiraSpec({ fetchImpl });
    // testConnection's api is constructed by the framework with the real
    // site URL at connect time; we mimic that by passing a stub that
    // proxies to fetchImpl.
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
