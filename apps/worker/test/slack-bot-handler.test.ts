import { describe, it, expect, vi } from 'vitest';
import { handleSlackBotJob, type SlackBotJob } from '../src/slack-bot/handler';

// Fake DB with chainable .select().from().where().limit() returning canned rows.
// Drizzle's actual chain is rich; we mimic just enough surface area for the
// two queries handler.ts makes (sources lookup, then connectorCredentials).
function makeFakeDb(opts: {
  sources?: Array<{ organizationId: string }>;
  credentials?: Array<{
    accessToken: string | null;
    lastRefreshedAt: Date | null;
    connectedAt: Date;
  }>;
}) {
  const queries: unknown[] = [];
  let queryIdx = -1;
  const rowsForCall = [opts.sources ?? [], opts.credentials ?? []];

  const chain = {
    from() {
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
      queries.push(queryIdx);
      return chain;
    },
  } as unknown as Parameters<typeof handleSlackBotJob>[1]['db'];
}

describe('handleSlackBotJob', () => {
  it('returns workspace_not_connected when team_id has no source row', async () => {
    const db = makeFakeDb({ sources: [], credentials: [] });
    const result = await handleSlackBotJob(
      {
        kind: 'app_mention',
        teamId: 'TUNKNOWN',
        channel: 'C1',
        threadTs: '1.2',
        asker: 'U1',
        text: '<@UBOT> hello',
      },
      { db, searchImpl: async () => [] },
    );
    expect(result).toEqual({ ok: false, reason: 'workspace_not_connected' });
  });

  it('returns workspace_not_connected when no active credentials exist', async () => {
    const db = makeFakeDb({
      sources: [{ organizationId: 'org-1' }],
      credentials: [],
    });
    const result = await handleSlackBotJob(
      {
        kind: 'app_mention',
        teamId: 'TGOOD',
        channel: 'C1',
        threadTs: '1.2',
        asker: 'U1',
        text: '<@UBOT> hello',
      },
      { db, searchImpl: async () => [] },
    );
    expect(result).toEqual({ ok: false, reason: 'workspace_not_connected' });
  });

  it('posts an ephemeral slash response and does not call search for empty queries', async () => {
    const db = makeFakeDb({
      sources: [{ organizationId: 'org-1' }],
      credentials: [
        {
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch;
    const searchImpl = vi.fn(async () => []);

    const job: SlackBotJob = {
      kind: 'slash_command',
      teamId: 'TGOOD',
      channel: 'C1',
      asker: 'U1',
      text: '   ',
      responseUrl: 'https://hooks.slack.com/commands/123',
    };
    const result = await handleSlackBotJob(job, { db, fetchImpl, searchImpl });
    expect(result).toEqual({ ok: true });
    expect(searchImpl).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/commands/123');
    const sentBody = JSON.parse((init as RequestInit).body as string);
    expect(sentBody.response_type).toBe('ephemeral');
  });

  it('makes slash response in_channel when --public flag is set', async () => {
    const db = makeFakeDb({
      sources: [{ organizationId: 'org-1' }],
      credentials: [
        {
          accessToken: 'xoxb-test',
          lastRefreshedAt: null,
          connectedAt: new Date('2026-01-01'),
        },
      ],
    });
    const fetchImpl = vi.fn(async () =>
      new Response('ok', { status: 200 }),
    ) as unknown as typeof fetch;
    const searchImpl = vi.fn(async () => []);

    const job: SlackBotJob = {
      kind: 'slash_command',
      teamId: 'TGOOD',
      channel: 'C1',
      asker: 'U1',
      text: '--public what is the deploy process',
      responseUrl: 'https://hooks.slack.com/commands/abc',
    };
    await handleSlackBotJob(job, { db, fetchImpl, searchImpl });

    expect(searchImpl).toHaveBeenCalledTimes(1);
    const searchArg = searchImpl.mock.calls[0][0] as { q: string; userSubjects: string[] };
    expect(searchArg.q).toBe('what is the deploy process');
    expect(searchArg.userSubjects).toEqual(['org:org-1']);

    const sentBody = JSON.parse(
      ((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody.response_type).toBe('in_channel');
  });
});
