import { describe, it, expect } from 'vitest';
import {
  runConnectorSync,
  type AllowlistEntry,
  type ChunkRecord,
  type RuntimeStores,
} from '@holo/connector-framework';
import { createSlackSpec, hasSlackBotScopes } from '../src/slack/index';

// Slack's API client paces itself at 1500ms between calls (Tier-3 endpoints
// like conversations.history cap at ~50/min). Sync tests issue several calls
// in sequence so they need a generous timeout. The framework path itself is
// fast — this is purely the in-process pacing budget.
const SLOW_TEST_MS = 30_000;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  allowlist?: ReadonlyArray<AllowlistEntry>;
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
        return { accessToken: 'xoxb-test', scope: 'channels:history,app_mentions:read' };
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
      async loadAllowlist() {
        return initial?.allowlist ?? [];
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  body: URLSearchParams;
}

function makeFetch(
  responder: (method: string, body: URLSearchParams) => unknown,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const u = String(url);
    const body = typeof init.body === 'string' ? new URLSearchParams(init.body) : new URLSearchParams();
    calls.push({ url: u, body });
    const method = u.replace(/.*\/api\//, '');
    return jsonResponse(responder(method, body));
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

const opts = { clientId: 'cid', clientSecret: 'csec' };

describe('createSlackSpec', () => {
  it('declares one resource and oauth2 with comma scope separator', () => {
    const spec = createSlackSpec(opts);
    expect(spec.id).toBe('slack');
    expect(spec.resources).toHaveLength(1);
    expect(spec.resources[0]!.id).toBe('threads');
    expect(spec.auth.kind).toBe('oauth2');
    expect(spec.auth.refreshable).toBe(false);
  });

  it('builds Slack authorize URL with comma-separated scopes', () => {
    const spec = createSlackSpec(opts);
    const url = spec.auth.buildAuthorizeUrl!({
      redirectUri: 'https://app/cb',
      state: 's',
    });
    expect(url).toContain('https://slack.com/oauth/v2/authorize?');
    expect(url).toContain('client_id=cid');
    // Slack uses comma-separated scopes (encoded as %2C).
    expect(url).toContain('scope=channels%3Ahistory%2C');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcb');
  });
});

describe('Slack OAuth — okPredicate handles 200-with-error', () => {
  it('throws HOLO_OAUTH_EXCHANGE_FAILED when ok: false (HTTP 200)', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: false, error: 'invalid_code' })) as unknown as typeof fetch;
    const spec = createSlackSpec({ ...opts, fetchImpl });
    await expect(
      spec.auth.exchangeCode!({ code: 'bad', redirectUri: 'r' }),
    ).rejects.toMatchObject({ code: 'HOLO_OAUTH_EXCHANGE_FAILED' });
  });

  it('returns access token on ok: true', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        ok: true,
        access_token: 'xoxb-real',
        scope: 'channels:history,app_mentions:read',
      })) as unknown as typeof fetch;
    const spec = createSlackSpec({ ...opts, fetchImpl });
    const tokens = await spec.auth.exchangeCode!({
      code: 'good',
      redirectUri: 'r',
    });
    expect(tokens.accessToken).toBe('xoxb-real');
    expect(tokens.scope).toBe('channels:history,app_mentions:read');
  });
});

describe('hasSlackBotScopes', () => {
  it('returns true when bot sentinel scope is present', () => {
    expect(hasSlackBotScopes('channels:history,app_mentions:read,chat:write')).toBe(true);
  });
  it('returns false when only ingest scopes are present', () => {
    expect(hasSlackBotScopes('channels:history,users:read')).toBe(false);
  });
  it('returns false on null/empty', () => {
    expect(hasSlackBotScopes(null)).toBe(false);
    expect(hasSlackBotScopes('')).toBe(false);
  });
});

describe('Slack sync — channel + thread iteration', () => {
  const explicitAllowlist: ReadonlyArray<AllowlistEntry> = [
    { pattern: 'C123', patternKind: 'exact_id', decision: 'include' },
  ];

  function userListResponse(): unknown {
    return {
      ok: true,
      members: [
        { id: 'U1', real_name: 'Alice', is_bot: false, name: 'alice' },
        { id: 'U2', real_name: 'Bob Bot', is_bot: true, name: 'bob' },
      ],
      response_metadata: {},
    };
  }

  it('emits one chunk per non-bot thread parent with no replies', { timeout: SLOW_TEST_MS }, async () => {
    const { fetchImpl } = makeFetch((method) => {
      switch (method) {
        case 'users.list':
          return userListResponse();
        case 'conversations.info':
          return {
            ok: true,
            channel: { id: 'C123', name: 'general', is_private: false, is_member: true },
          };
        case 'conversations.history':
          return {
            ok: true,
            messages: [
              {
                ts: '1700000001.000000',
                user: 'U1',
                text: 'hello world',
                reply_count: 0,
              },
            ],
            response_metadata: {},
          };
        default:
          return { ok: true };
      }
    });

    const spec = createSlackSpec({ ...opts, fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores({ allowlist: explicitAllowlist });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(enqueued.length).toBeGreaterThan(0);
    expect(enqueued[0]!.kind).toBe('slack-thread');
    expect(enqueued[0]!.sourceArtifactId).toBe(
      'slack-thread:C123:1700000001.000000',
    );
    // Cursor advances past the seen ts.
    const last = savedCursors.at(-1)?.cursor as {
      oldestPerChannel: Record<string, string>;
    };
    expect(parseFloat(last.oldestPerChannel['C123']!)).toBeGreaterThan(
      1700000001.0,
    );
  });

  it('marks bot_not_in_channel when conversations.history returns not_in_channel', { timeout: SLOW_TEST_MS }, async () => {
    const { fetchImpl } = makeFetch((method) => {
      switch (method) {
        case 'users.list':
          return userListResponse();
        case 'conversations.info':
          return {
            ok: true,
            channel: { id: 'C123', name: 'private', is_private: true, is_member: false },
          };
        case 'conversations.history':
          return { ok: false, error: 'not_in_channel' };
        default:
          return { ok: true };
      }
    });

    const spec = createSlackSpec({ ...opts, fetchImpl });
    const { stores, savedCursors } = makeStores({ allowlist: explicitAllowlist });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const last = savedCursors.at(-1)?.cursor as {
      botNotInChannel: string[];
    };
    expect(last.botNotInChannel).toContain('C123');
  });

  it('falls back to listMemberChannels when allowlist is empty', { timeout: SLOW_TEST_MS }, async () => {
    const { fetchImpl, calls } = makeFetch((method) => {
      switch (method) {
        case 'conversations.list':
          return {
            ok: true,
            channels: [
              { id: 'C-AUTO', name: 'auto', is_private: false, is_member: true },
            ],
            response_metadata: {},
          };
        case 'users.list':
          return userListResponse();
        case 'conversations.info':
          return {
            ok: true,
            channel: { id: 'C-AUTO', name: 'auto', is_private: false, is_member: true },
          };
        case 'conversations.history':
          return { ok: true, messages: [], response_metadata: {} };
        default:
          return { ok: true };
      }
    });

    const spec = createSlackSpec({ ...opts, fetchImpl });
    const { stores } = makeStores({ allowlist: [] });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    // Empty allowlist → fell back to conversations.list.
    expect(
      calls.some((c) => c.url.endsWith('/conversations.list')),
    ).toBe(true);
  });
});

describe('Slack testConnection', () => {
  it('returns workspace identity from auth.test', async () => {
    const { fetchImpl } = makeFetch(() => ({
      ok: true,
      team_id: 'TXYZ',
      team: 'Acme Slack',
      user_id: 'UBOT',
    }));
    const spec = createSlackSpec({ ...opts, fetchImpl });
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'xoxb-t' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 'xoxb-t' } });
    expect(result.externalId).toBe('TXYZ');
    expect(result.name).toBe('Acme Slack');
  });
});
