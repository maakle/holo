import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

const getServerContextMock = vi.fn();
vi.mock('./server-context', () => ({
  getServerContext: () => getServerContextMock(),
}));

import { withActiveOrg } from './with-active-org';
import { holoError, ErrorCode } from '@holo/errors';

function fakeReq(): Parameters<ReturnType<typeof withActiveOrg>>[0] {
  return new Request('http://localhost/api/test') as unknown as Parameters<
    ReturnType<typeof withActiveOrg>
  >[0];
}

describe('withActiveOrg', () => {
  beforeEach(() => {
    getServerContextMock.mockReset();
  });

  it('401s when no session', async () => {
    getServerContextMock.mockResolvedValue({
      auth: { api: { getSession: async () => null } },
    });
    const handler = withActiveOrg(async () => ({ ok: true }));
    const res = await handler(fakeReq());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(ErrorCode.HOLO_AUTH_NO_SESSION);
  });

  it('401s when session has no active org', async () => {
    getServerContextMock.mockResolvedValue({
      auth: {
        api: {
          getSession: async () => ({ user: { id: 'u1' }, session: {} }),
        },
      },
    });
    const handler = withActiveOrg(async () => ({ ok: true }));
    const res = await handler(fakeReq());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(ErrorCode.HOLO_AUTH_NO_ACTIVE_ORG);
  });

  it('passes resolved orgId, ctx, session, and params through', async () => {
    const sessionRow = {
      user: { id: 'u1' },
      session: { activeOrganizationId: 'org-7' },
    };
    const ctxStub = {
      auth: { api: { getSession: async () => sessionRow } },
      db: 'db-stub',
    };
    getServerContextMock.mockResolvedValue(ctxStub);
    const seen: { orgId?: string; userId?: string; provider?: string; ctx?: unknown } = {};
    const handler = withActiveOrg<{ provider: string }>(async ({ ctx, session, orgId, params }) => {
      seen.orgId = orgId;
      seen.userId = session.user.id;
      seen.provider = params.provider;
      seen.ctx = ctx;
      return { ok: true };
    });
    const res = await handler(fakeReq(), {
      params: Promise.resolve({ provider: 'github' }),
    });
    expect(res.status).toBe(200);
    expect(seen.orgId).toBe('org-7');
    expect(seen.userId).toBe('u1');
    expect(seen.provider).toBe('github');
    expect(seen.ctx).toBe(ctxStub);
  });

  it('translates HoloError thrown by handler to its mapped status code', async () => {
    getServerContextMock.mockResolvedValue({
      auth: {
        api: {
          getSession: async () => ({
            user: { id: 'u1' },
            session: { activeOrganizationId: 'org-7' },
          }),
        },
      },
    });
    const handler = withActiveOrg(async () => {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'no such row',
        fix: 'create one',
      });
    });
    const res = await handler(fakeReq());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; problem: string };
    expect(body.code).toBe(ErrorCode.HOLO_NOT_FOUND);
    expect(body.problem).toBe('no such row');
  });

  it('returns 500 for unknown errors', async () => {
    getServerContextMock.mockResolvedValue({
      auth: {
        api: {
          getSession: async () => ({
            user: { id: 'u1' },
            session: { activeOrganizationId: 'org-7' },
          }),
        },
      },
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withActiveOrg(async () => {
      throw new Error('boom');
    });
    const res = await handler(fakeReq());
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('serializes plain object returns as JSON 200', async () => {
    getServerContextMock.mockResolvedValue({
      auth: {
        api: {
          getSession: async () => ({
            user: { id: 'u1' },
            session: { activeOrganizationId: 'org-7' },
          }),
        },
      },
    });
    const handler = withActiveOrg(async () => ({ hello: 'world' }));
    const res = await handler(fakeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string };
    expect(body.hello).toBe('world');
  });
});
