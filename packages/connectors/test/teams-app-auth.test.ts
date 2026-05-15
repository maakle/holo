import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadTeamsBotAccessToken,
  TEAMS_BOT_SCOPE,
  TEAMS_GRAPH_SCOPE,
  __clearTeamsBotTokenCacheForTests,
} from '../src/teams/app-auth';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const APP_SECRET = 'super-secret';
const CUSTOMER_TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function mockTokenFetch(
  responses: Array<{ token: string; expiresIn?: number }>,
): typeof fetch {
  let i = 0;
  const seen: Array<{ url: string; scope: string }> = [];
  const f: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const body = (init?.body as string) ?? '';
    const scopeMatch = body.match(/scope=([^&]+)/);
    seen.push({ url, scope: decodeURIComponent(scopeMatch?.[1] ?? '') });
    const r = responses[i++];
    if (!r) throw new Error(`mock token fetch: ran out of responses at call ${i}`);
    return new Response(
      JSON.stringify({ access_token: r.token, expires_in: r.expiresIn ?? 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  (f as unknown as { __seen: typeof seen }).__seen = seen;
  return f;
}

function seenCalls(f: typeof fetch): Array<{ url: string; scope: string }> {
  return (f as unknown as { __seen: Array<{ url: string; scope: string }> }).__seen;
}

describe('loadTeamsBotAccessToken — backwards compat with the bot path', () => {
  beforeEach(() => __clearTeamsBotTokenCacheForTests());

  it('defaults to the Bot Framework tenant + bot scope when none supplied', async () => {
    const fetchImpl = mockTokenFetch([{ token: 'bot-token-1' }]);
    const result = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetchImpl,
    });
    expect(result.accessToken).toBe('bot-token-1');
    const calls = seenCalls(fetchImpl);
    expect(calls[0]!.url).toContain('/botframework.com/oauth2/');
    expect(calls[0]!.scope).toBe(TEAMS_BOT_SCOPE);
  });

  it('caches per (appId, tenantId, scope) — bot and Graph tokens never collide', async () => {
    // First call: bot path; second: Graph path. Both should mint
    // fresh tokens despite sharing the appId, because their cache
    // keys differ on (tenantId, scope).
    const fetchImpl = mockTokenFetch([
      { token: 'bot-token' },
      { token: 'graph-token-tenant-A' },
    ]);
    const bot = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetchImpl,
    });
    const graph = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: CUSTOMER_TENANT,
      scope: TEAMS_GRAPH_SCOPE,
      fetchImpl,
    });
    expect(bot.accessToken).toBe('bot-token');
    expect(graph.accessToken).toBe('graph-token-tenant-A');
    const calls = seenCalls(fetchImpl);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/botframework.com/');
    expect(calls[1]!.url).toContain(`/${CUSTOMER_TENANT}/`);
  });

  it('reuses the cached bot token on the next call', async () => {
    const fetchImpl = mockTokenFetch([{ token: 'bot-token-cached' }]);
    const a = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetchImpl,
    });
    const b = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      fetchImpl,
    });
    expect(a.accessToken).toBe(b.accessToken);
    expect(seenCalls(fetchImpl)).toHaveLength(1);
  });
});

describe('loadTeamsBotAccessToken — Graph path', () => {
  beforeEach(() => __clearTeamsBotTokenCacheForTests());

  it('mints against the customer tenant with the Graph scope', async () => {
    const fetchImpl = mockTokenFetch([{ token: 'graph-token' }]);
    const r = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: CUSTOMER_TENANT,
      scope: TEAMS_GRAPH_SCOPE,
      fetchImpl,
    });
    expect(r.accessToken).toBe('graph-token');
    const calls = seenCalls(fetchImpl);
    expect(calls[0]!.url).toBe(
      `https://login.microsoftonline.com/${CUSTOMER_TENANT}/oauth2/v2.0/token`,
    );
    expect(calls[0]!.scope).toBe(TEAMS_GRAPH_SCOPE);
  });

  it('caches per customer tenant — Graph tokens for tenant A and tenant B are separate', async () => {
    const fetchImpl = mockTokenFetch([
      { token: 'graph-token-A' },
      { token: 'graph-token-B' },
    ]);
    const a = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: CUSTOMER_TENANT,
      scope: TEAMS_GRAPH_SCOPE,
      fetchImpl,
    });
    const b = await loadTeamsBotAccessToken({
      appId: APP_ID,
      appSecret: APP_SECRET,
      tenantId: '99999999-9999-9999-9999-999999999999',
      scope: TEAMS_GRAPH_SCOPE,
      fetchImpl,
    });
    expect(a.accessToken).not.toBe(b.accessToken);
    expect(seenCalls(fetchImpl)).toHaveLength(2);
  });

  it('surfaces a Graph-specific fix hint when the token exchange fails', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: 'invalid_client',
          error_description: 'AADSTS7000222: Invalid client secret',
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    // The Graph branch sets `fix` to the RSC-consent hint; the bot
    // branch sets it to the App-ID/secret hint. `holoError` puts
    // `code: problem` on `.message` and the hint on `.fix`, so match
    // the `.fix` property directly.
    try {
      await loadTeamsBotAccessToken({
        appId: APP_ID,
        appSecret: 'wrong',
        tenantId: CUSTOMER_TENANT,
        scope: TEAMS_GRAPH_SCOPE,
        fetchImpl,
      });
      throw new Error('expected throw');
    } catch (err) {
      expect((err as { fix?: string }).fix).toContain('Resource-Specific Consent');
    }
  });
});
