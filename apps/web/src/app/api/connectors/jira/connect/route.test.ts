import { describe, it, expect, vi, beforeEach } from 'vitest';

const headersMock = vi.fn(async () => new Headers());
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

const getServerContextMock = vi.fn();
vi.mock('@/lib/server-context', () => ({ getServerContext: () => getServerContextMock() }));

const resolveActiveOrgIdMock = vi.fn(() => 'org-1');
vi.mock('@/lib/active-org', () => ({ resolveActiveOrgId: (_s: unknown) => resolveActiveOrgIdMock() }));

const enqueueInitialSyncMock = vi.fn(async () => undefined);
vi.mock('@/lib/sync-queue', () => ({ enqueueInitialSync: () => enqueueInitialSyncMock() }));

const emitAuditEventMock = vi.fn();
vi.mock('@holo/audit', () => ({ emitAuditEvent: (...args: unknown[]) => emitAuditEventMock(...args) }));

import { POST } from './route';

function fakeSession() {
  return { user: { id: 'user-1' } };
}

function makeDb() {
  const selectChain = {
    from: () => selectChain,
    where: () => Promise.resolve([] as unknown[]),
  };
  const insertChain = {
    values: () => insertChain,
    onConflictDoUpdate: () => Promise.resolve(undefined),
    returning: () => Promise.resolve([{ id: 'cred-1' }]),
  };
  const updateChain = {
    set: () => updateChain,
    where: () => Promise.resolve(undefined),
  };
  return {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  };
}

function makeAuth() {
  return {
    api: { getSession: vi.fn(async () => fakeSession()) },
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/connectors/jira/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = typeof url === 'string' ? url : (url as URL).toString();
    if (u.endsWith('/rest/api/3/myself')) {
      return new Response(
        JSON.stringify({
          accountId: 'u-jane',
          displayName: 'Jane Doe',
          emailAddress: 'jane@acme.test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (u.endsWith('/rest/api/3/serverInfo')) {
      return new Response(
        JSON.stringify({
          baseUrl: 'https://acme.atlassian.net',
          serverTitle: 'ACME Jira',
          cloudId: 'cloud-abc',
          version: '1.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
});

describe('POST /api/connectors/jira/connect', () => {
  it('400s when siteUrl is missing', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    const res = await POST(makeRequest({ email: 'a@b.com', token: 't' }));
    expect(res.status).toBe(400);
  });

  it('400s when siteUrl is not parseable', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    const res = await POST(
      makeRequest({ siteUrl: 'not a url at all', email: 'a@b.com', token: 't' }),
    );
    expect(res.status).toBe(400);
  });

  it('400s when /myself returns 401 (bad token)', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      if (u.endsWith('/rest/api/3/myself')) {
        return new Response('Unauthorized', { status: 401 });
      }
      throw new Error('unexpected');
    }) as unknown as typeof fetch;

    const res = await POST(
      makeRequest({
        siteUrl: 'https://acme.atlassian.net',
        email: 'jane@acme.test',
        token: 'bad-token',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toMatch(/HOLO_/);
  });

  it('persists credential + source and enqueues initial sync on success', async () => {
    const db = makeDb();
    const insertSpy = vi.spyOn(db, 'insert');
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db });
    const res = await POST(
      makeRequest({
        siteUrl: 'https://acme.atlassian.net/',
        email: 'jane@acme.test',
        token: 'jira-api-token',
      }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalled();
    expect(enqueueInitialSyncMock).toHaveBeenCalled();
    expect(emitAuditEventMock).toHaveBeenCalled();
  });

  it('normalizes a trailing-slash + pathful siteUrl to host-only https', async () => {
    const db = makeDb();
    const fetchCalls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      fetchCalls.push(u);
      if (u.endsWith('/rest/api/3/myself')) {
        return new Response(
          JSON.stringify({ accountId: 'u', displayName: 'D' }),
          { status: 200 },
        );
      }
      if (u.endsWith('/rest/api/3/serverInfo')) {
        return new Response(
          JSON.stringify({ baseUrl: 'https://acme.atlassian.net', cloudId: 'c' }),
          { status: 200 },
        );
      }
      throw new Error('unexpected');
    }) as unknown as typeof fetch;

    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db });
    await POST(
      makeRequest({
        siteUrl: 'HTTPS://Acme.Atlassian.NET/jira/your-work/',
        email: 'a@b.com',
        token: 't',
      }),
    );
    expect(fetchCalls.every((u) => u.startsWith('https://acme.atlassian.net/'))).toBe(true);
  });
});
