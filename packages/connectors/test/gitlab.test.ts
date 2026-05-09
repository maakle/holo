import { describe, it, expect } from 'vitest';
import { createGitlabSpec } from '../src/gitlab/index';
import { createGitlabApiClient } from '../src/gitlab/api';
import { runGitlabProseSync } from '../src/gitlab/sync-prose';
import { runGitlabCodeSync } from '../src/gitlab/sync-code';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'text/plain', ...(init.headers ?? {}) },
  });
}

interface CapturedRequest {
  url: string;
  method: string;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit = {}) => {
    const captured: CapturedRequest = {
      url: String(url),
      method: init.method ?? 'GET',
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

describe('createGitlabSpec', () => {
  const opts = { clientId: 'cid', clientSecret: 'csec' };

  it('declares id, http config, and prose+code resources', () => {
    const spec = createGitlabSpec(opts);
    expect(spec.id).toBe('gitlab');
    expect(spec.displayName).toBe('GitLab');
    expect(spec.http?.baseUrl).toBe('https://gitlab.com/api/v4');
    expect(spec.auth.kind).toBe('oauth2');
    expect(spec.resources.map((r) => r.id).sort()).toEqual(['code', 'prose']);
  });

  it('builds the OAuth authorize URL with read_api + read_repository + read_user', () => {
    const spec = createGitlabSpec(opts);
    const url = spec.auth.buildAuthorizeUrl!({
      redirectUri: 'https://app/cb',
      state: 'state-jwt',
    });
    expect(url).toContain('https://gitlab.com/oauth/authorize?');
    expect(url).toContain('client_id=cid');
    // Default scope separator is space → URL-encoded as '+' or '%20'
    expect(url).toMatch(/scope=read_api(\+|%20)read_repository(\+|%20)read_user/);
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb');
    expect(url).toContain('state=state-jwt');
  });
});

describe('GitlabApiClient.getCurrentUser', () => {
  it('GETs /user with bearer token and returns the user', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonResponse({ id: 42, username: 'octocat', name: 'The Cat' }),
    );
    const client = createGitlabApiClient('tok', fetchImpl);
    const user = await client.getCurrentUser();
    expect(user).toEqual({ id: 42, username: 'octocat', name: 'The Cat' });
    expect(calls[0]!.url).toBe('https://gitlab.com/api/v4/user');
  });
});

describe('runGitlabProseSync', () => {
  it('emits a doc chunk for the README and an MR chunk per merge request', async () => {
    const projects = [
      { id: 100, pathWithNamespace: 'group/project', defaultBranch: 'main' },
    ];

    let mrCalls = 0;
    let issueCalls = 0;
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/repository/files/README.md/raw')) {
        return textResponse('# Hello\n\nThis is the readme body.');
      }
      if (req.url.includes('/merge_requests/1/notes')) {
        return jsonResponse([]);
      }
      if (req.url.includes('/merge_requests') && !req.url.includes('/notes')) {
        mrCalls += 1;
        if (mrCalls > 1) return jsonResponse([]);
        return jsonResponse([
          {
            iid: 1,
            title: 'Add feature',
            description: 'Body of the MR',
            state: 'opened',
            updated_at: '2026-05-01T00:00:00.000Z',
            merged_at: null,
            web_url: 'https://gitlab.com/group/project/-/merge_requests/1',
            author: { username: 'alice' },
          },
        ]);
      }
      if (req.url.includes('/issues') && !req.url.includes('/notes')) {
        issueCalls += 1;
        return jsonResponse([]);
      }
      // README candidates we don't care about
      return jsonResponse(null, { status: 404 });
    });

    type Chunk = {
      externalId: string;
      kind: string;
      content: string;
      sourceArtifactId: string;
    };
    const enqueued: Chunk[] = [];
    const result = await runGitlabProseSync({
      client: createGitlabApiClient('tok', fetchImpl),
      allowedProjects: projects,
      cursorMetadata: {},
      organizationId: 'org-1',
      sourceId: 'src-1',
      async enqueueEmbed({ chunks }) {
        enqueued.push(...chunks);
      },
    });

    const docChunks = enqueued.filter((c) => c.kind === 'gitlab-doc');
    const mrChunks = enqueued.filter((c) => c.kind === 'gitlab-mr');
    expect(docChunks.length).toBeGreaterThan(0);
    expect(mrChunks.length).toBeGreaterThan(0);
    expect(mrChunks[0]!.sourceArtifactId).toBe('gitlab-mr:group/project!1');
    expect(result.artifactCount).toBeGreaterThan(0);
    const watermark = (
      result.updatedMetadata['per_project_updated_at'] as Record<string, string>
    )['100'];
    expect(watermark).toBe('2026-05-01T00:00:00.000Z');
    expect(issueCalls).toBeGreaterThan(0);
  });
});

describe('runGitlabCodeSync', () => {
  it('skips when head SHA matches the prior cursor', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (req.url.includes('/repository/branches/main')) {
        return jsonResponse({ name: 'main', commit: { id: 'sha-abc' } });
      }
      throw new Error(`unexpected url ${req.url}`);
    });
    const enqueued: unknown[] = [];
    const result = await runGitlabCodeSync({
      client: createGitlabApiClient('tok', fetchImpl),
      project: { id: 100, pathWithNamespace: 'group/project', defaultBranch: 'main' },
      fromSha: 'sha-abc',
      organizationId: 'org-1',
      sourceId: 'src-1',
      async enqueueEmbed({ chunks }) {
        enqueued.push(...chunks);
      },
    });
    expect(result.artifactCount).toBe(0);
    expect(result.headSha).toBe('sha-abc');
    expect(enqueued).toHaveLength(0);
    // Only the branch lookup; no tree walk.
    expect(calls).toHaveLength(1);
  });

  it('walks the tree and emits a code chunk per text blob', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (req.url.includes('/repository/branches/main')) {
        return jsonResponse({ name: 'main', commit: { id: 'sha-new' } });
      }
      if (req.url.includes('/repository/tree')) {
        return jsonResponse([
          { id: 'f1', name: 'index.ts', type: 'blob', path: 'src/index.ts' },
          // skipped: lockfile name
          { id: 'f2', name: 'package-lock.json', type: 'blob', path: 'package-lock.json' },
          // skipped: binary extension
          { id: 'f3', name: 'logo.png', type: 'blob', path: 'assets/logo.png' },
          // skipped: tree entry
          { id: 'f4', name: 'src', type: 'tree', path: 'src' },
        ]);
      }
      if (req.url.includes('/repository/files/')) {
        return textResponse('export const x = 1;\nconsole.log(x);');
      }
      throw new Error(`unexpected url ${req.url}`);
    });
    const enqueued: { kind: string; sourceArtifactId: string }[] = [];
    const result = await runGitlabCodeSync({
      client: createGitlabApiClient('tok', fetchImpl),
      project: { id: 100, pathWithNamespace: 'group/project', defaultBranch: 'main' },
      organizationId: 'org-1',
      sourceId: 'src-1',
      async enqueueEmbed({ chunks }) {
        enqueued.push(...chunks);
      },
    });
    expect(result.headSha).toBe('sha-new');
    expect(result.artifactCount).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.kind).toBe('gitlab-code');
    expect(enqueued[0]!.sourceArtifactId).toBe('gitlab-code:group/project:src/index.ts');
  });
});
