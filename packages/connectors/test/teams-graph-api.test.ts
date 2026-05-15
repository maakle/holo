import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTeamsGraphClient,
  __clearTeamsBotTokenCacheForTests,
} from '../src/teams/index';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const APP_SECRET = 'secret';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

interface MockCall {
  url: string;
  method: string;
}

/**
 * Single fetch impl that:
 *   - handles token mints (any URL matching /oauth2/v2.0/token)
 *   - delegates everything else to the supplied `handler`
 *   - records every call in `calls`
 */
function makeFetch(
  handler: (req: MockCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method as string) ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/oauth2/v2.0/token')) {
      return new Response(
        JSON.stringify({ access_token: 'fake-graph-token', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return handler({ url, method });
  };
  return { fetchImpl, calls };
}

function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('createTeamsGraphClient — basic Graph calls', () => {
  beforeEach(() => __clearTeamsBotTokenCacheForTests());

  it('getOrganization returns the first row of /organization', async () => {
    const { fetchImpl } = makeFetch(({ url }) => {
      if (url.endsWith('/organization?$select=id,displayName')) {
        return jsonRes({
          value: [{ id: TENANT, displayName: 'Contoso' }],
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    const org = await client.getOrganization();
    expect(org).toEqual({ id: TENANT, displayName: 'Contoso' });
  });

  it('listTeamChannels walks @odata.nextLink across pages', async () => {
    const pages = [
      {
        value: [{ id: 'ch1', displayName: 'general' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/_page2',
      },
      {
        value: [{ id: 'ch2', displayName: 'random' }],
      },
    ];
    let idx = 0;
    const { fetchImpl } = makeFetch(() => jsonRes(pages[idx++]!));
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    const channels = await client.listTeamChannels('team-1');
    expect(channels.map((c) => c.id)).toEqual(['ch1', 'ch2']);
  });

  it('forwards Bearer token on every Graph request', async () => {
    const authHeaders: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/oauth2/v2.0/token')) {
        return jsonRes({ access_token: 'graph-token-xyz', expires_in: 3600 });
      }
      const headers = new Headers(init?.headers as HeadersInit);
      authHeaders.push(headers.get('Authorization') ?? '');
      return jsonRes({ value: [] });
    };
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    await client.listTeamChannels('team-1');
    expect(authHeaders[0]).toBe('Bearer graph-token-xyz');
  });

  it('honors Retry-After on 429 and retries the request', async () => {
    let count = 0;
    const { fetchImpl } = makeFetch(() => {
      count += 1;
      if (count === 1) {
        return new Response(JSON.stringify({ error: 'throttled' }), {
          status: 429,
          headers: { 'retry-after': '1' }, // 1 second
        });
      }
      return jsonRes({ value: [{ id: 'ok', displayName: 'after-retry' }] });
    });
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    const start = Date.now();
    const channels = await client.listTeamChannels('team-1');
    const elapsed = Date.now() - start;
    expect(channels[0]?.id).toBe('ok');
    // Retry-After: 1 → at least 1 second slept; max-wait is 1s in the
    // mock so 5s gives plenty of headroom for slow CI.
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(5_000);
  });

  it('surfaces 403 with a "RSC consent revoked / bot removed" fix hint', async () => {
    const { fetchImpl } = makeFetch(() =>
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    );
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    // HoloError serializes `code: problem` into `.message`; the
    // recovery hint lives on `.fix` — assert against that.
    try {
      await client.listTeamChannels('team-1');
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { fix?: string }).fix).toMatch(
        /removed from this channel\/chat or the tenant revoked consent/,
      );
    }
  });

  it('channelMessagesDeltaInit hits /messages/delta', async () => {
    const { fetchImpl, calls } = makeFetch(() =>
      jsonRes({
        value: [],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/_resume',
      }),
    );
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    const page = await client.channelMessagesDeltaInit('team-1', 'ch-1');
    expect(page['@odata.deltaLink']).toBe(
      'https://graph.microsoft.com/v1.0/_resume',
    );
    const graphCall = calls.find((c) => !c.url.includes('/oauth2/'));
    expect(graphCall!.url).toContain('/teams/team-1/channels/ch-1/messages/delta');
  });

  it('fetchUrl resumes from an arbitrary nextLink / deltaLink', async () => {
    const resumeUrl =
      'https://graph.microsoft.com/v1.0/teams/team-1/channels/ch-1/messages/delta?$deltatoken=abc';
    const { fetchImpl, calls } = makeFetch(({ url }) => {
      if (url === resumeUrl) return jsonRes({ value: [] });
      throw new Error(`unexpected url: ${url}`);
    });
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    await client.fetchUrl(resumeUrl);
    expect(calls.find((c) => c.url === resumeUrl)).toBeDefined();
  });

  it('getUser returns null for 404 (guest user left tenant) but throws on 500', async () => {
    const { fetchImpl } = makeFetch(({ url }) => {
      if (url.includes('/users/missing')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    });
    const client = createTeamsGraphClient({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: TENANT,
      fetchImpl,
    });
    const user = await client.getUser('missing');
    expect(user).toBeNull();
    await expect(client.getUser('exists')).rejects.toThrow(/500/);
  });
});
