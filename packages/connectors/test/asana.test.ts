import { describe, it, expect } from 'vitest';
import { runConnectorSync, type RuntimeStores, type ChunkRecord } from '@holo/connector-framework';
import { createAsanaSpec } from '../src/asana/index';
import type { AsanaTask, AsanaProject, AsanaWorkspace } from '../src/asana/types';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeTask(partial: Partial<AsanaTask> & { gid: string; modified_at: string }): AsanaTask {
  return {
    gid: partial.gid,
    name: partial.name ?? `Task ${partial.gid}`,
    notes: partial.notes ?? null,
    due_on: partial.due_on ?? null,
    due_at: partial.due_at ?? null,
    completed: partial.completed ?? false,
    completed_at: partial.completed_at ?? null,
    created_at: partial.created_at ?? '2026-04-01T00:00:00.000Z',
    modified_at: partial.modified_at,
    permalink_url: partial.permalink_url ?? `https://app.asana.com/0/0/${partial.gid}`,
    assignee: partial.assignee ?? null,
    projects: partial.projects ?? [{ gid: 'p1', name: 'Roadmap' }],
    workspace: partial.workspace ?? { gid: 'ws1', name: 'Acme' },
    memberships: partial.memberships ?? [],
    tags: partial.tags ?? [],
    parent: partial.parent ?? null,
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
        return { accessToken: 'asana_test_pat' };
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
  method: string;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

const WORKSPACE: AsanaWorkspace = { gid: 'ws1', name: 'Acme' };
const PROJECT_ROADMAP: AsanaProject = { gid: 'p1', name: 'Roadmap' };
const PROJECT_OPS: AsanaProject = { gid: 'p2', name: 'Ops' };

/**
 * Helper that wires up the canonical Asana endpoint sequence the spec hits.
 * The default responder returns the configured fixtures once and stops
 * paginating after the first page for each entity.
 */
function buildAsanaResponder(opts: {
  workspaces?: AsanaWorkspace[];
  projects?: AsanaProject[];
  tasksByProject?: Record<string, AsanaTask[]>;
}): (req: CapturedRequest) => Response {
  const workspaces = opts.workspaces ?? [WORKSPACE];
  const projects = opts.projects ?? [PROJECT_ROADMAP];
  const tasksByProject = opts.tasksByProject ?? {};
  return (req: CapturedRequest) => {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/users/me')) {
      return jsonResponse({
        data: { gid: 'u1', name: 'Alice', email: 'alice@example.com', workspaces },
      });
    }
    const projectsMatch = url.pathname.match(/\/workspaces\/([^/]+)\/projects$/);
    if (projectsMatch) {
      return jsonResponse({ data: projects, next_page: null });
    }
    if (url.pathname.endsWith('/tasks')) {
      const projectGid = url.searchParams.get('project') ?? '';
      const tasks = tasksByProject[projectGid] ?? [];
      return jsonResponse({ data: tasks, next_page: null });
    }
    return jsonResponse({ data: [], next_page: null });
  };
}

describe('createAsanaSpec', () => {
  it('declares the expected id, http config, and one resource', () => {
    const spec = createAsanaSpec();
    expect(spec.id).toBe('asana');
    expect(spec.displayName).toBe('Asana');
    expect(spec.http?.baseUrl).toBe('https://app.asana.com/api/1.0');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('tasks');
    expect(spec.auth.kind).toBe('apiKey');
  });
});

describe('Asana sync (full)', () => {
  it('walks workspaces → projects → tasks and emits one chunk per task', async () => {
    const tasksRoadmap = [
      makeTask({ gid: 't1', name: 'Ship onboarding', modified_at: '2026-05-01T10:00:00Z' }),
      makeTask({ gid: 't2', name: 'Wire metrics', modified_at: '2026-05-02T10:00:00Z' }),
    ];
    const tasksOps = [
      makeTask({
        gid: 't3',
        name: 'Renew SOC2',
        projects: [PROJECT_OPS],
        modified_at: '2026-05-03T10:00:00Z',
      }),
    ];

    const { fetchImpl, calls } = makeFetch(
      buildAsanaResponder({
        projects: [PROJECT_ROADMAP, PROJECT_OPS],
        tasksByProject: { p1: tasksRoadmap, p2: tasksOps },
      }),
    );

    const spec = createAsanaSpec({ fetchImpl });
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
    // Cursor advances to the highest modified_at across all tasks.
    expect(result.cursorPatch['tasks']).toEqual({ modifiedAt: '2026-05-03T10:00:00Z' });
    expect(savedCursors.at(-1)).toEqual({
      resourceId: 'tasks',
      cursor: { modifiedAt: '2026-05-03T10:00:00Z' },
    });

    // The sync hit /users/me once (resource sync), then /projects per workspace,
    // then /tasks per project — exact endpoint count is implementation detail,
    // but at minimum we should see one tasks call per project.
    const tasksCalls = calls.filter((c) => c.url.includes('/tasks?'));
    expect(tasksCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('emits chunks with the expected shape and metadata', async () => {
    const task = makeTask({
      gid: 't1',
      name: 'Fix login crash',
      notes: 'Users hit a 500 on /login when SSO is misconfigured.',
      modified_at: '2026-05-01T10:00:00Z',
      completed: false,
      due_on: '2026-05-10',
      assignee: { gid: 'u1', name: 'Alice', email: 'alice@example.com' },
      projects: [{ gid: 'p1', name: 'Auth Hardening' }],
      tags: [{ gid: 'tag1', name: 'bug' }],
    });

    const { fetchImpl } = makeFetch(
      buildAsanaResponder({ tasksByProject: { p1: [task] } }),
    );

    const spec = createAsanaSpec({ fetchImpl });
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
    expect(chunk.kind).toBe('asana-task');
    expect(chunk.provider).toBe('asana');
    expect(chunk.externalId).toBe('t1');
    expect(chunk.sourceArtifactId).toBe('asana-task:t1');
    expect(chunk.content).toContain('[ ] Fix login crash');
    expect(chunk.content).toContain('Status: Open');
    expect(chunk.content).toContain('Projects: Auth Hardening');
    expect(chunk.content).toContain('Assignee: Alice');
    expect(chunk.content).toContain('Due: 2026-05-10');
    expect(chunk.content).toContain('Tags: bug');
    expect(chunk.content).toContain('Users hit a 500 on /login when SSO is misconfigured.');
    expect(chunk.aclSubjects).toEqual(['asana:workspace:ws1', 'asana:org', 'asana:project:p1']);
    expect(chunk.metadata['url']).toBe('https://app.asana.com/0/0/t1');
    expect(chunk.metadata['projectNames']).toEqual(['Auth Hardening']);
    expect(chunk.metadata['tags']).toEqual(['bug']);
    expect(chunk.metadata['completed']).toBe(false);
  });

  it('uses [x] for completed tasks', async () => {
    const task = makeTask({
      gid: 't1',
      name: 'Done thing',
      modified_at: '2026-05-01T10:00:00Z',
      completed: true,
      completed_at: '2026-05-01T09:00:00Z',
    });
    const { fetchImpl } = makeFetch(
      buildAsanaResponder({ tasksByProject: { p1: [task] } }),
    );
    const spec = createAsanaSpec({ fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued[0]!.content).toContain('[x] Done thing');
    expect(enqueued[0]!.content).toContain('Status: Completed');
  });

  it('attaches the PAT as Authorization: Bearer …', async () => {
    const { fetchImpl, calls } = makeFetch(buildAsanaResponder({}));
    const spec = createAsanaSpec({ fetchImpl });
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer asana_test_pat');
  });
});

describe('Asana sync (incremental)', () => {
  it('passes the stored cursor as the modified_since query param', async () => {
    const { fetchImpl, calls } = makeFetch(
      buildAsanaResponder({
        tasksByProject: {
          p1: [makeTask({ gid: 't1', modified_at: '2026-05-04T10:00:00Z' })],
        },
      }),
    );

    const spec = createAsanaSpec({ fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({
      cursors: { tasks: { modifiedAt: '2026-05-03T10:00:00Z' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const tasksCall = calls.find((c) => c.url.includes('/tasks?'));
    expect(tasksCall).toBeDefined();
    expect(new URL(tasksCall!.url).searchParams.get('modified_since')).toBe(
      '2026-05-03T10:00:00Z',
    );
    expect(enqueued).toHaveLength(1);
    expect(result.cursorPatch['tasks']).toEqual({ modifiedAt: '2026-05-04T10:00:00Z' });
    expect(savedCursors.at(-1)?.cursor).toEqual({ modifiedAt: '2026-05-04T10:00:00Z' });
  });

  it('keeps the existing cursor when no new tasks are returned', async () => {
    const { fetchImpl } = makeFetch(buildAsanaResponder({}));
    const spec = createAsanaSpec({ fetchImpl });
    const { stores, enqueued } = makeStores({
      cursors: { tasks: { modifiedAt: '2026-05-03T10:00:00Z' } },
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
    expect(result.cursorPatch['tasks']).toEqual({ modifiedAt: '2026-05-03T10:00:00Z' });
  });
});

describe('Asana sync (pagination)', () => {
  it('follows next_page.offset for tasks until exhausted', async () => {
    const tasksP1 = [makeTask({ gid: 't1', modified_at: '2026-05-01T10:00:00Z' })];
    const tasksP2 = [makeTask({ gid: 't2', modified_at: '2026-05-02T10:00:00Z' })];

    const { fetchImpl, calls } = makeFetch((req) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/users/me')) {
        return jsonResponse({
          data: { gid: 'u1', name: 'Alice', email: 'a@b.c', workspaces: [WORKSPACE] },
        });
      }
      if (url.pathname.match(/\/workspaces\/[^/]+\/projects$/)) {
        return jsonResponse({ data: [PROJECT_ROADMAP], next_page: null });
      }
      if (url.pathname.endsWith('/tasks')) {
        const offset = url.searchParams.get('offset');
        if (!offset) {
          return jsonResponse({ data: tasksP1, next_page: { offset: 'PAGE2' } });
        }
        return jsonResponse({ data: tasksP2, next_page: null });
      }
      return jsonResponse({ data: [] });
    });

    const spec = createAsanaSpec({ fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    expect(enqueued).toHaveLength(2);
    const taskCalls = calls.filter((c) => c.url.includes('/tasks?'));
    expect(taskCalls).toHaveLength(2);
    expect(new URL(taskCalls[1]!.url).searchParams.get('offset')).toBe('PAGE2');
  });
});

describe('Asana /users/me opt_fields', () => {
  it('requests email + workspaces via opt_fields (they are not in the compact default)', async () => {
    const { fetchImpl, calls } = makeFetch(buildAsanaResponder({}));
    const spec = createAsanaSpec({ fetchImpl });
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const meCall = calls.find((c) => c.url.includes('/users/me'));
    expect(meCall).toBeDefined();
    const optFields = new URL(meCall!.url).searchParams.get('opt_fields') ?? '';
    expect(optFields).toContain('workspaces.gid');
    expect(optFields).toContain('workspaces.name');
    expect(optFields).toContain('email');
  });
});

describe('Asana testConnection', () => {
  it('returns the first workspace gid + name from /users/me', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: {
          gid: 'u1',
          name: 'Alice',
          email: 'a@b.c',
          workspaces: [{ gid: 'ws-abc', name: 'Acme Inc' }],
        },
      }),
    );
    const spec = createAsanaSpec({ fetchImpl });
    const { createHttpClient } = await import('@holo/connector-framework');
    const tokens = { accessToken: 'pat' };
    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens,
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens });
    expect(result.externalId).toBe('ws-abc');
    expect(result.name).toBe('Acme Inc');
  });

  it('throws when /users/me returns no workspaces', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        data: { gid: 'u1', name: 'Alice', email: 'a@b.c', workspaces: [] },
      }),
    );
    const spec = createAsanaSpec({ fetchImpl });
    const { createHttpClient } = await import('@holo/connector-framework');
    const tokens = { accessToken: 'pat' };
    const api = createHttpClient({
      config: spec.http!,
      auth: spec.auth,
      tokens,
      fetchImpl,
      sleep: async () => {},
    });
    await expect(spec.testConnection({ api, tokens })).rejects.toThrow(/no workspaces/i);
  });
});
