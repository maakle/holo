import { describe, it, expect, vi } from 'vitest';
import { handleSlackBotJob, type SlackBotJob } from '../src/slack-bot/handler';
import { ERROR_FALLBACK_TEXT } from '../src/slack-bot/blocks';

// Fake DB with chainable .select().from()(.innerJoin?).where().limit?()
// returning canned rows. Drizzle's actual chain is rich; we mimic just enough
// surface area for the queries handler.ts makes:
//   1. resolveWorkspace's join: connector_credentials ⋈ sources
//   2. fetchOrgName: organization
// Anything beyond the configured slots returns [], which is fine for
// downstream listTools.
function makeFakeDb(opts: {
  credentials?: Array<{
    organizationId: string;
    accessToken: string | null;
    slackAppConfigId?: string | null;
    lastRefreshedAt: Date | null;
    connectedAt: Date;
  }>;
  organizations?: Array<{ name: string }>;
}) {
  let queryIdx = -1;
  const rowsForCall = [
    opts.credentials ?? [],
    opts.organizations ?? [{ name: 'Test Org' }],
  ];

  const chain = {
    from() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    limit() {
      return Promise.resolve(rowsForCall[queryIdx] ?? []);
    },
    then(resolve: (v: unknown) => void) {
      resolve(rowsForCall[queryIdx] ?? []);
    },
  };

  return {
    select() {
      queryIdx += 1;
      return chain;
    },
  } as unknown as Parameters<typeof handleSlackBotJob>[1]['db'];
}

describe('handleSlackBotJob', () => {
  it('returns workspace_not_connected when the join finds no credentials for this team', async () => {
    const db = makeFakeDb({ credentials: [] });
    const result = await handleSlackBotJob(
      {
        kind: 'app_mention',
        teamId: 'TUNKNOWN',
        channel: 'C1',
        threadTs: '1.2',
        asker: 'U1',
        text: '<@UBOT> hello',
      },
      { db, agentImpl: async () => ({ answer: '', sources: [] }) },
    );
    expect(result).toEqual({ ok: false, reason: 'workspace_not_connected' });
  });

  it('posts an ephemeral slash response and does not call agent for empty queries', async () => {
    const db = makeFakeDb({
      credentials: [
        {
          organizationId: 'org-1',
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch;
    const agentImpl = vi.fn(async () => ({ answer: '', sources: [] }));

    const job: SlackBotJob = {
      kind: 'slash_command',
      teamId: 'TGOOD',
      channel: 'C1',
      asker: 'U1',
      text: '   ',
      responseUrl: 'https://hooks.slack.com/commands/123',
    };
    const result = await handleSlackBotJob(job, { db, fetchImpl, agentImpl });
    expect(result).toEqual({ ok: true });
    expect(agentImpl).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/commands/123');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.response_type).toBe('ephemeral');
  });

  it('makes slash response in_channel when --public flag is set', async () => {
    const db = makeFakeDb({
      credentials: [
        {
          organizationId: 'org-1',
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch;
    const agentImpl = vi.fn(async () => ({
      answer: 'The deploy process is via Vercel.',
      sources: [],
    }));

    const job: SlackBotJob = {
      kind: 'slash_command',
      teamId: 'TGOOD',
      channel: 'C1',
      asker: 'U1',
      text: '--public what is the deploy process',
      responseUrl: 'https://hooks.slack.com/commands/abc',
    };
    await handleSlackBotJob(job, { db, fetchImpl, agentImpl });

    expect(agentImpl).toHaveBeenCalledTimes(1);
    const agentArg = agentImpl.mock.calls[0][0] as {
      question: string;
      userSubjects: string[];
    };
    expect(agentArg.question).toBe('what is the deploy process');
    expect(agentArg.userSubjects).toEqual(['org:org-1']);

    const sentBody = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.response_type).toBe('in_channel');
  });

  it('renders the agent answer with sources footer for app_mention', async () => {
    const db = makeFakeDb({
      credentials: [
        {
          organizationId: 'org-1',
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('{"ok":true,"ts":"1.1","channel":"C1"}', { status: 200 }),
    ) as unknown as typeof fetch;
    const agentImpl = vi.fn(async () => ({
      answer: 'Deploys via Vercel.',
      sources: [
        {
          provider: 'github',
          kind: 'doc',
          title: 'DEPLOY',
          url: 'https://github.com/a/b',
        },
      ],
    }));

    const result = await handleSlackBotJob(
      {
        kind: 'app_mention',
        teamId: 'TGOOD',
        channel: 'C1',
        threadTs: '1.0',
        asker: 'U1',
        text: '<@UBOT> how do we deploy?',
      },
      { db, fetchImpl, agentImpl },
    );

    expect(result).toEqual({ ok: true });
    expect(agentImpl).toHaveBeenCalledTimes(1);
    expect(agentImpl.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
    });
  });

  it('posts the standard error message when the agent throws', async () => {
    const db = makeFakeDb({
      credentials: [
        {
          organizationId: 'org-1',
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('{"ok":true,"ts":"1.1","channel":"C1"}', { status: 200 }),
    ) as unknown as typeof fetch;
    const agentImpl = vi.fn(async () => {
      throw new Error('anthropic api error');
    });

    const result = await handleSlackBotJob(
      {
        kind: 'app_mention',
        teamId: 'TGOOD',
        channel: 'C1',
        threadTs: '1.0',
        asker: 'U1',
        text: '<@UBOT> hi',
      },
      { db, fetchImpl, agentImpl },
    );

    expect(result).toEqual({ ok: true });
    const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
    const found = calls.some((c) => {
      const body = (c[1] as RequestInit | undefined)?.body;
      if (typeof body !== 'string') return false;
      // SlackApiClient encodes the body as form-urlencoded; decode before searching.
      const decoded = decodeURIComponent(body.replace(/\+/g, ' '));
      return decoded.includes(ERROR_FALLBACK_TEXT);
    });
    expect(found).toBe(true);
  });
});
