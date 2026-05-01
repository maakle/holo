import { describe, it, expect, vi } from 'vitest';
import { runSlackSync, type RunSlackSyncInput } from '../../src/slack/sync';
import type { SlackApiClient, SlackMember, SlackChannel, SlackMessage } from '../../src/slack/api-client';

function mockClient(overrides: Partial<SlackApiClient> = {}): SlackApiClient {
  return {
    usersList: vi.fn().mockResolvedValue([
      { id: 'U1', real_name: 'Alice', is_bot: false },
      { id: 'U2', real_name: 'Bob', is_bot: false },
      { id: 'UBOT', real_name: 'GitHubBot', is_bot: true },
    ] as SlackMember[]),
    conversationsInfo: vi.fn().mockImplementation((channelId: string): Promise<SlackChannel> =>
      Promise.resolve({ id: channelId, name: channelId === 'C01' ? 'general' : 'eng', is_private: false, is_member: true }),
    ),
    conversationsHistory: vi.fn().mockResolvedValue({ messages: [], nextCursor: undefined }),
    conversationsReplies: vi.fn().mockResolvedValue([] as SlackMessage[]),
    ...overrides,
  };
}

function baseInput(overrides: Partial<RunSlackSyncInput> = {}): RunSlackSyncInput {
  return {
    client: mockClient(),
    allowedChannelIds: ['C01', 'C02'],
    cursorMetadata: {},
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runSlackSync', () => {
  it('pulls history for each channel, produces chunks for non-bot threads', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      conversationsHistory: vi.fn().mockImplementation((channelId: string) => {
        if (channelId === 'C01') {
          return Promise.resolve({
            messages: [
              { ts: '1700000001.000100', user: 'U1', text: 'parent msg', thread_ts: '1700000001.000100', reply_count: 1 },
            ] as SlackMessage[],
            nextCursor: undefined,
          });
        }
        return Promise.resolve({
          messages: [
            { ts: '1700000002.000100', user: 'U2', text: 'standalone', reply_count: 0 },
            { ts: '1700000002.000200', user: 'UBOT', text: 'bot noise', reply_count: 0 },
          ] as SlackMessage[],
          nextCursor: undefined,
        });
      }),
      conversationsReplies: vi.fn().mockResolvedValue([
        { ts: '1700000001.000100', user: 'U1', text: 'parent msg' },
        { ts: '1700000001.000200', user: 'U2', text: 'reply' },
      ] as SlackMessage[]),
    });

    const result = await runSlackSync(baseInput({ client, enqueueEmbed }));

    expect(result.artifactCount).toBe(2); // 1 thread from C01, 1 msg from C02 (bot skipped)
    expect(enqueueEmbed).toHaveBeenCalledTimes(2);
    const calls = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.find((c: [{ channelId: string }]) => c[0].channelId === 'C01')![0].chunks).toHaveLength(1);
    expect(calls.find((c: [{ channelId: string }]) => c[0].channelId === 'C02')![0].chunks).toHaveLength(1);
  });

  it('advances oldest_per_channel in updatedMetadata', async () => {
    const client = mockClient({
      conversationsHistory: vi.fn().mockResolvedValue({
        messages: [{ ts: '1700000005.000000', user: 'U1', text: 'hi', reply_count: 0 }] as SlackMessage[],
        nextCursor: undefined,
      }),
    });
    const result = await runSlackSync(baseInput({ client, allowedChannelIds: ['C01'] }));
    const meta = result.updatedMetadata['oldest_per_channel'] as Record<string, string>;
    expect(parseFloat(meta['C01']!)).toBeGreaterThan(1700000005);
  });

  it('incremental sync passes existing oldest cursor per channel', async () => {
    const conversationsHistory = vi.fn().mockResolvedValue({ messages: [], nextCursor: undefined });
    await runSlackSync(
      baseInput({
        client: mockClient({ conversationsHistory }),
        cursorMetadata: { oldest_per_channel: { C01: '1700000010.000000' } },
        allowedChannelIds: ['C01'],
      }),
    );
    expect(conversationsHistory).toHaveBeenCalledWith('C01', expect.objectContaining({ oldest: '1700000010.000000' }));
  });

  it('skips bot messages and records no chunks for them', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      conversationsHistory: vi.fn().mockResolvedValue({
        messages: [
          { ts: '1700000001.000100', user: 'UBOT', text: 'CI passed', reply_count: 0 },
        ] as SlackMessage[],
        nextCursor: undefined,
      }),
    });
    const result = await runSlackSync(baseInput({ client, enqueueEmbed, allowedChannelIds: ['C01'] }));
    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('bot-not-invited: logs warning, records channelId in bot_not_in_channel, continues to next channel', async () => {
    const warnings: unknown[] = [];
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      conversationsHistory: vi.fn().mockImplementation((channelId: string) => {
        if (channelId === 'C01') {
          const err = Object.assign(new Error('not_in_channel'), { data: { error: 'not_in_channel' } });
          return Promise.reject(err);
        }
        return Promise.resolve({
          messages: [{ ts: '1700000003.000000', user: 'U1', text: 'hi', reply_count: 0 }] as SlackMessage[],
          nextCursor: undefined,
        });
      }),
    });

    const result = await runSlackSync(
      baseInput({
        client,
        enqueueEmbed,
        logger: { warn: (obj) => warnings.push(obj) },
      }),
    );

    expect(result.artifactCount).toBe(1); // C02 still processed
    const meta = result.updatedMetadata;
    expect((meta['bot_not_in_channel'] as string[])).toContain('C01');
    expect((meta['bot_not_in_channel'] as string[])).not.toContain('C02');
    expect(warnings.some((w) => (w as { code: string }).code === 'HOLO_SLACK_BOT_NOT_INVITED')).toBe(true);
  });

  it('deduplicates chunks with matching hashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined);
    const client = mockClient({
      conversationsHistory: vi.fn().mockResolvedValue({
        messages: [{ ts: '1700000001.000000', user: 'U1', text: 'repeat msg', reply_count: 0 }] as SlackMessage[],
        nextCursor: undefined,
      }),
    });
    // First run to get hash
    const r1 = await runSlackSync(baseInput({ client, enqueueEmbed, allowedChannelIds: ['C01'] }));
    expect(r1.artifactCount).toBe(1);

    // Extract the hash and put it in existingHashes
    const enqueued = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0].chunks as Array<{ contentHash: string }>;
    const existingHashes = new Set(enqueued.map((c) => c.contentHash));

    const r2 = await runSlackSync(
      baseInput({ client, enqueueEmbed: vi.fn(), allowedChannelIds: ['C01'], existingHashes }),
    );
    expect(r2.artifactCount).toBe(0);
  });

  it('throws HOLO_ALLOWLIST_EMPTY when no channels provided', async () => {
    await expect(
      runSlackSync(baseInput({ allowedChannelIds: [] })),
    ).rejects.toMatchObject({ code: 'HOLO_ALLOWLIST_EMPTY' });
  });

  it('connector buildAuthorizeUrl includes required scopes', async () => {
    const { createSlackConnector } = await import('../../src/slack/index');
    const c = createSlackConnector({ clientId: 'cid', clientSecret: 'sec' });
    const url = c.buildAuthorizeUrl({ redirectUri: 'https://app/cb', state: 'xyz' });
    expect(url).toContain('https://slack.com/oauth/v2/authorize');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('state=xyz');
    expect(url).toContain('channels%3Ahistory');
  });

  it('connector exchangeCode throws on Slack error response', async () => {
    const { createSlackConnector } = await import('../../src/slack/index');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'invalid_code' }), { status: 200 }),
    );
    const c = createSlackConnector({ clientId: 'cid', clientSecret: 'sec', fetchImpl });
    await expect(c.exchangeCode({ code: 'bad', redirectUri: 'x' })).rejects.toMatchObject({
      code: 'HOLO_OAUTH_EXCHANGE_FAILED',
    });
  });

  it('connector testConnection returns workspace identity', async () => {
    const { createSlackConnector } = await import('../../src/slack/index');
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, team_id: 'T123', team: 'Acme' }), { status: 200 }),
    );
    const c = createSlackConnector({ clientId: 'cid', clientSecret: 'sec', fetchImpl });
    const result = await c.testConnection({ accessToken: 'xoxb-test' });
    expect(result).toEqual({ ok: true, externalId: 'T123', name: 'Acme', raw: expect.any(Object) });
  });
});
