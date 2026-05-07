import { describe, it, expect } from 'vitest';
import { runConnectorSync, type RuntimeStores, type ChunkRecord } from '@holo/connector-framework';
import { createLinearSpec } from '../src/linear/index';
import type { LinearIssue } from '../src/linear/types';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeIssue(partial: Partial<LinearIssue> & { id: string; updatedAt: string }): LinearIssue {
  return {
    id: partial.id,
    identifier: partial.identifier ?? `ENG-${partial.id}`,
    title: partial.title ?? `Issue ${partial.id}`,
    description: partial.description ?? null,
    url: partial.url ?? `https://linear.app/holo/issue/${partial.id}`,
    priority: partial.priority ?? 2,
    priorityLabel: partial.priorityLabel ?? 'Medium',
    createdAt: partial.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: partial.updatedAt,
    state: partial.state ?? { id: 's-todo', name: 'Todo', type: 'unstarted' },
    assignee: partial.assignee ?? null,
    team: partial.team ?? { id: 't-eng', name: 'Engineering', key: 'ENG' },
    project: partial.project ?? null,
    labels: partial.labels ?? { nodes: [] },
  };
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
        return { accessToken: 'lin_test_token' };
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
  body: { query: string; variables: Record<string, unknown> } | null;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    let body: CapturedRequest['body'] = null;
    if (typeof init.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = null;
      }
    }
    const captured: CapturedRequest = { url: String(url), body, headers };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

describe('createLinearSpec', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('declares the expected id, http config, and one resource', () => {
    const spec = createLinearSpec(opts);
    expect(spec.id).toBe('linear');
    expect(spec.displayName).toBe('Linear');
    expect(spec.http?.baseUrl).toBe('https://api.linear.app');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('issues');
    expect(spec.auth.kind).toBe('oauth2');
  });

  it('builds the OAuth authorize URL with `read` scope', () => {
    const spec = createLinearSpec(opts);
    const url = spec.auth.buildAuthorizeUrl!({
      redirectUri: 'https://app/cb',
      state: 'state-jwt',
    });
    expect(url).toContain('https://linear.app/oauth/authorize?');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('scope=read');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb');
    expect(url).toContain('state=state-jwt');
  });
});

describe('Linear sync (full)', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('paginates through multiple GraphQL pages and emits one chunk per issue', async () => {
    const issuesP1 = [
      makeIssue({ id: 'i1', identifier: 'ENG-1', title: 'one', updatedAt: '2026-05-01T10:00:00Z' }),
      makeIssue({ id: 'i2', identifier: 'ENG-2', title: 'two', updatedAt: '2026-05-02T10:00:00Z' }),
    ];
    const issuesP2 = [
      makeIssue({ id: 'i3', identifier: 'ENG-3', title: 'three', updatedAt: '2026-05-03T10:00:00Z' }),
    ];

    const { fetchImpl, calls } = makeFetch((req) => {
      const after = req.body?.variables['after'];
      if (after === 'cursor-1') {
        return jsonResponse({
          data: {
            issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: issuesP2 },
          },
        });
      }
      return jsonResponse({
        data: {
          issues: { pageInfo: { hasNextPage: true, endCursor: 'cursor-1' }, nodes: issuesP1 },
        },
      });
    });

    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores();

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBe(3);
    expect(enqueued).toHaveLength(3);

    // Three GraphQL calls: page 1 (after=null), page 2 (after=cursor-1), no page 3.
    expect(calls.filter((c) => c.url.endsWith('/graphql'))).toHaveLength(2);
    expect(calls[0]!.body?.variables['after']).toBeNull();
    expect(calls[1]!.body?.variables['after']).toBe('cursor-1');

    // Cursor advances to the highest updatedAt seen.
    expect(result.cursorPatch['issues']).toEqual({ updatedAt: '2026-05-03T10:00:00Z' });
    expect(savedCursors.at(-1)).toEqual({
      resourceId: 'issues',
      cursor: { updatedAt: '2026-05-03T10:00:00Z' },
    });
  });

  it('emits chunks with the expected shape and metadata', async () => {
    const issue = makeIssue({
      id: 'i1',
      identifier: 'ENG-42',
      title: 'Fix login crash',
      description: 'Users hit a 500 on /login when SSO is misconfigured.',
      updatedAt: '2026-05-01T10:00:00Z',
      priorityLabel: 'High',
      assignee: { id: 'u1', name: 'Alice', email: 'alice@example.com' },
      project: { id: 'p1', name: 'Auth Hardening' },
      labels: { nodes: [{ id: 'l1', name: 'bug' }, { id: 'l2', name: 'p1' }] },
    });

    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [issue] } },
      }),
    );

    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(enqueued).toHaveLength(1);
    const chunk = enqueued[0]!;
    expect(chunk.kind).toBe('linear-issue');
    expect(chunk.provider).toBe('linear');
    expect(chunk.externalId).toBe('i1');
    expect(chunk.sourceArtifactId).toBe('linear-linear-issue:i1');
    expect(chunk.content).toContain('[ENG-42] Fix login crash');
    expect(chunk.content).toContain('Status: Todo');
    expect(chunk.content).toContain('Priority: High');
    expect(chunk.content).toContain('Team: Engineering');
    expect(chunk.content).toContain('Project: Auth Hardening');
    expect(chunk.content).toContain('Assignee: Alice');
    expect(chunk.content).toContain('Labels: bug, p1');
    expect(chunk.content).toContain('Users hit a 500 on /login when SSO is misconfigured.');
    expect(chunk.aclSubjects).toEqual(['linear:team:t-eng', 'linear:org']);
    expect(chunk.metadata['identifier']).toBe('ENG-42');
    expect(chunk.metadata['priorityLabel']).toBe('High');
    expect(chunk.metadata['labels']).toEqual(['bug', 'p1']);
  });

  it('attaches Authorization: Bearer <token> to every request', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({
        data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      }),
    );
    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer lin_test_token');
  });
});

describe('Linear sync (incremental)', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('passes the stored cursor as the GraphQL `since` variable', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({
        data: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [makeIssue({ id: 'i1', updatedAt: '2026-05-04T10:00:00Z' })],
          },
        },
      }),
    );

    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      cursors: { issues: { updatedAt: '2026-05-03T10:00:00Z' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    expect(calls[0]!.body?.variables['since']).toBe('2026-05-03T10:00:00Z');
    expect(enqueued).toHaveLength(1);
    expect(result.cursorPatch['issues']).toEqual({ updatedAt: '2026-05-04T10:00:00Z' });
    expect(savedCursors.at(-1)?.cursor).toEqual({ updatedAt: '2026-05-04T10:00:00Z' });
  });

  it('keeps the existing cursor when no new issues are returned', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
      }),
    );
    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { issues: { updatedAt: '2026-05-03T10:00:00Z' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(result.artifactCount).toBe(0);
    expect(enqueued).toHaveLength(0);
    expect(result.cursorPatch['issues']).toEqual({ updatedAt: '2026-05-03T10:00:00Z' });
  });
});

describe('Linear error handling', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('surfaces GraphQL `errors` array as HOLO_FETCH_FAILED', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({ errors: [{ message: 'Authentication required' }] }),
    );
    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores } = makeStores();
    await expect(
      runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl }),
    ).rejects.toMatchObject({
      code: 'HOLO_FETCH_FAILED',
      problem: expect.stringContaining('Authentication required'),
    });
  });

  it('rejects when `data` field is missing', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const spec = createLinearSpec({ ...opts, fetchImpl });
    const { stores } = makeStores();
    await expect(
      runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl }),
    ).rejects.toMatchObject({ code: 'HOLO_FETCH_FAILED' });
  });
});

describe('Linear testConnection', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('returns the org id and name from the viewer query', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: {
          viewer: {
            id: 'u1',
            name: 'Alice',
            email: 'alice@example.com',
            organization: { id: 'org-abc', name: 'Holo Inc', urlKey: 'holo' },
          },
        },
      }),
    );
    const spec = createLinearSpec({ ...opts, fetchImpl });
    // The framework's testConnection takes a TestConnectionContext with an
    // HTTP client preconfigured with the user's tokens. Build it the same
    // way the runtime would.
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      // For testing, swap in apiKey so we don't need the OAuth path; the
      // tokens just need an accessToken to set the Authorization header.
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'lin_token' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({
      api,
      tokens: { accessToken: 'lin_token' },
    });
    expect(result.externalId).toBe('org-abc');
    expect(result.name).toBe('Holo Inc');
  });
});
