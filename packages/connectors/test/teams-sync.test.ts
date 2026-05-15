import { describe, it, expect } from 'vitest';
import { ErrorCode, holoError } from '@holo/errors';
import {
  groupThreads,
  parseStoredCursor,
  runTenantSync,
  type EmittedThread,
  type ResourceEmission,
  type TeamsCursor,
} from '../src/teams/sync';
import type {
  GraphChannel,
  GraphChat,
  GraphChatMessage,
  GraphCollection,
  GraphTeam,
} from '../src/teams/graph-types';
import type { TeamsGraphClient } from '../src/teams/graph-api';

/** Minimal Graph message helper for fixtures. */
function msg(over: Partial<GraphChatMessage> & { id: string }): GraphChatMessage {
  return {
    id: over.id,
    createdDateTime: over.createdDateTime ?? '2026-05-15T10:00:00Z',
    messageType: 'message',
    body: { contentType: 'text', content: 'hello' },
    from: { user: { id: 'aad-default', displayName: 'Default User' } },
    ...over,
  };
}

/**
 * In-memory Graph mock — only implements the methods `runTenantSync`
 * touches. Cursor state machine doesn't care about HTTP details.
 */
interface MockGraphSpec {
  teams: GraphTeam[];
  channelsByTeam: Record<string, GraphChannel[]>;
  chats: GraphChat[];
  /** `channelMessages[teamId/channelId]` → list of pages returned in order. */
  channelMessages: Record<string, GraphCollection<GraphChatMessage>[]>;
  /** `chatMessages[chatId]` → list of pages returned in order. */
  chatMessages: Record<string, GraphCollection<GraphChatMessage>[]>;
  /** Forced errors by URL substring (first match wins). */
  errors?: Array<{ urlPart: string; status: number }>;
}

function makeMockGraph(spec: MockGraphSpec): TeamsGraphClient {
  const channelCalls = new Map<string, number>();
  const chatCalls = new Map<string, number>();
  function nextPage(
    map: Map<string, number>,
    pages: GraphCollection<GraphChatMessage>[] | undefined,
    key: string,
  ): GraphCollection<GraphChatMessage> {
    if (!pages || pages.length === 0) return { value: [] };
    const i = map.get(key) ?? 0;
    map.set(key, i + 1);
    return pages[Math.min(i, pages.length - 1)]!;
  }

  function maybeThrow(url: string): void {
    const err = spec.errors?.find((e) => url.includes(e.urlPart));
    if (err) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Microsoft Graph ${err.status} from ${url}: synthetic`,
        fix: 'mock',
      });
    }
  }

  return {
    async getOrganization() {
      return { id: 'tenant-a', displayName: 'Tenant A' };
    },
    async listJoinedTeams() {
      return spec.teams;
    },
    async listTeamChannels(teamId: string) {
      maybeThrow(`/teams/${teamId}/channels`);
      return spec.channelsByTeam[teamId] ?? [];
    },
    async listChannelMessages(teamId: string, channelId: string) {
      const key = `${teamId}/${channelId}`;
      maybeThrow(`/teams/${teamId}/channels/${channelId}/messages`);
      return nextPage(channelCalls, spec.channelMessages[key], key);
    },
    async channelMessagesDeltaInit(teamId: string, channelId: string) {
      const key = `${teamId}/${channelId}`;
      maybeThrow(`/teams/${teamId}/channels/${channelId}/messages/delta`);
      return nextPage(channelCalls, spec.channelMessages[key], key);
    },
    async fetchUrl<T>(url: string): Promise<T> {
      maybeThrow(url);
      // Identify if this is a channel resume, chat resume, or chats list.
      // Mock convention: a "resume URL" carries a token like
      // `?$skiptoken=...&__key=<key>` so the mock can route it.
      const m = url.match(/__key=([^&]+)/);
      if (m && m[1]) {
        const key = decodeURIComponent(m[1]);
        if (spec.channelMessages[key]) {
          return nextPage(channelCalls, spec.channelMessages[key], key) as unknown as T;
        }
        if (spec.chatMessages[key]) {
          return nextPage(chatCalls, spec.chatMessages[key], key) as unknown as T;
        }
      }
      return { value: [] } as unknown as T;
    },
    async listChats() {
      return {
        value: spec.chats,
      };
    },
    async listChatMessages(chatId: string) {
      const key = chatId;
      maybeThrow(`/chats/${chatId}/messages`);
      return nextPage(chatCalls, spec.chatMessages[key], key);
    },
    async chatMessagesDeltaInit(chatId: string) {
      const key = chatId;
      maybeThrow(`/chats/${chatId}/messages/delta`);
      return nextPage(chatCalls, spec.chatMessages[key], key);
    },
    async listTeamMembers() {
      return [];
    },
    async listChatMembers() {
      return [];
    },
    async getUser() {
      return null;
    },
  };
}

function collect(emissions: ResourceEmission[]): {
  threads: EmittedThread[];
  deletions: number;
  archived: string[];
} {
  return {
    threads: emissions.filter((e): e is { kind: 'thread'; thread: EmittedThread } => e.kind === 'thread').map((e) => e.thread),
    deletions: emissions.filter((e) => e.kind === 'deletion').length,
    archived: emissions
      .filter((e): e is { kind: 'archived'; resourceCursorKey: string } => e.kind === 'archived')
      .map((e) => e.resourceCursorKey),
  };
}

describe('groupThreads', () => {
  it('puts replies under their root and sorts by createdDateTime', () => {
    const all = [
      msg({ id: 'root-1', createdDateTime: '2026-05-15T10:00:00Z' }),
      msg({
        id: 'reply-late',
        replyToId: 'root-1',
        createdDateTime: '2026-05-15T10:05:00Z',
      }),
      msg({
        id: 'reply-early',
        replyToId: 'root-1',
        createdDateTime: '2026-05-15T10:01:00Z',
      }),
    ];
    const threads = groupThreads(all);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe('root-1');
    expect(threads[0]!.replies.map((r) => r.id)).toEqual(['reply-early', 'reply-late']);
  });

  it('drops orphan replies whose root isn\'t in the same page', () => {
    const all = [
      msg({ id: 'reply-orphan', replyToId: 'missing-root' }),
      msg({ id: 'root-here' }),
    ];
    const threads = groupThreads(all);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.id).toBe('root-here');
  });

  it('dedupes duplicate roots (first wins)', () => {
    const all = [
      msg({ id: 'root-1', body: { contentType: 'text', content: 'first' } }),
      msg({ id: 'root-1', body: { contentType: 'text', content: 'duplicate' } }),
    ];
    const threads = groupThreads(all);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.root.body?.content).toBe('first');
  });
});

describe('parseStoredCursor', () => {
  it('accepts backfill / delta / archived entries', () => {
    const raw = {
      'channel-A:B': { phase: 'backfill', nextLink: 'https://x/page2' },
      'chat-C': { phase: 'delta', deltaLink: 'https://x/resume' },
      'channel-X:Y': { phase: 'archived', removedAt: '2026-05-01T00:00:00Z' },
    };
    const out = parseStoredCursor(raw);
    expect(out['channel-A:B']).toEqual({
      phase: 'backfill',
      nextLink: 'https://x/page2',
    });
    expect(out['chat-C']).toEqual({ phase: 'delta', deltaLink: 'https://x/resume' });
    expect(out['channel-X:Y']?.phase).toBe('archived');
  });

  it('drops malformed entries (treated as first-run)', () => {
    expect(parseStoredCursor(null)).toEqual({});
    expect(parseStoredCursor('not an object')).toEqual({});
    expect(parseStoredCursor({ 'k': { phase: 'unknown' } })).toEqual({});
    expect(parseStoredCursor({ 'k': { phase: 'delta' /* missing deltaLink */ } })).toEqual({});
  });
});

describe('runTenantSync — happy path', () => {
  it('first run emits threads and stores a delta cursor per resource', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-1', displayName: 'general', membershipType: 'standard' },
        ],
      },
      chats: [{ id: 'chat-1', topic: 'Planning', chatType: 'group' }],
      channelMessages: {
        'team-1/ch-1': [
          {
            value: [
              msg({ id: 'root-1', createdDateTime: '2026-05-15T10:00:00Z' }),
              msg({
                id: 'r1',
                replyToId: 'root-1',
                createdDateTime: '2026-05-15T10:01:00Z',
              }),
            ],
            '@odata.deltaLink': 'https://graph/team-1/ch-1/delta-token',
          },
        ],
      },
      chatMessages: {
        'chat-1': [
          {
            value: [msg({ id: 'chat-root-1' })],
            '@odata.deltaLink': 'https://graph/chat-1/delta-token',
          },
        ],
      },
    });
    const emissions: ResourceEmission[] = [];
    const { cursor, result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    const { threads, deletions, archived } = collect(emissions);
    expect(threads).toHaveLength(2);
    expect(deletions).toBe(0);
    expect(archived).toEqual([]);
    expect(result.threadsEmitted).toBe(2);
    expect(result.resourcesSynced).toBe(2);

    // Both resources should have promoted to delta phase.
    expect(cursor['channel-team-1:ch-1']).toEqual({
      phase: 'delta',
      deltaLink: 'https://graph/team-1/ch-1/delta-token',
    });
    expect(cursor['chat-chat-1']).toEqual({
      phase: 'delta',
      deltaLink: 'https://graph/chat-1/delta-token',
    });
  });

  it('skips shared channels (out of scope for v1)', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-shared', displayName: 'cross-tenant', membershipType: 'shared' },
        ],
      },
      chats: [],
      channelMessages: {},
      chatMessages: {},
    });
    const emissions: ResourceEmission[] = [];
    const { result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    expect(result.resourcesSynced).toBe(0);
    expect(collect(emissions).threads).toHaveLength(0);
  });

  it('skips 1:1 chats (the bot\'s own DMs are noise, not corpus)', async () => {
    const graph = makeMockGraph({
      teams: [],
      channelsByTeam: {},
      chats: [{ id: 'chat-dm', chatType: 'oneOnOne' }],
      channelMessages: {},
      chatMessages: {
        'chat-dm': [
          {
            value: [msg({ id: 'm1' })],
            '@odata.deltaLink': 'https://x',
          },
        ],
      },
    });
    const emissions: ResourceEmission[] = [];
    const { result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    expect(result.resourcesSynced).toBe(0);
    expect(collect(emissions).threads).toHaveLength(0);
  });

  it('filters system events and emits deletions for removed messages', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-1', displayName: 'general', membershipType: 'standard' },
        ],
      },
      chats: [],
      channelMessages: {
        'team-1/ch-1': [
          {
            value: [
              // System event: should be filtered, not emitted.
              msg({ id: 'sys-1', messageType: 'systemEventMessage' }),
              // Real message: should land as a thread.
              msg({ id: 'root-1' }),
              // Deleted via delta — should emit a deletion.
              {
                id: 'deleted-1',
                createdDateTime: '2026-05-15T10:00:00Z',
                messageType: 'message',
                '@removed': { reason: 'deleted' },
              },
            ],
            '@odata.deltaLink': 'https://x/delta',
          },
        ],
      },
      chatMessages: {},
    });
    const emissions: ResourceEmission[] = [];
    await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    const { threads, deletions } = collect(emissions);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.rootMessageId).toBe('root-1');
    expect(deletions).toBe(1);
  });
});

describe('runTenantSync — error handling', () => {
  it('archives the source when a channel returns 403 (bot removed)', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [{ id: 'ch-x', displayName: 'private', membershipType: 'private' }],
      },
      chats: [],
      channelMessages: {},
      chatMessages: {},
      errors: [{ urlPart: '/channels/ch-x/messages', status: 403 }],
    });
    const emissions: ResourceEmission[] = [];
    const { cursor, result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    expect(result.archivedResources).toEqual(['channel-team-1:ch-x']);
    expect(collect(emissions).archived).toEqual(['channel-team-1:ch-x']);
    expect(cursor['channel-team-1:ch-x']?.phase).toBe('archived');
  });

  it('resets to backfill when a stored deltaLink returns 410 Gone', async () => {
    // Mock returns 410 on any url containing `expired-delta`.
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-1', displayName: 'general', membershipType: 'standard' },
        ],
      },
      chats: [],
      channelMessages: {},
      chatMessages: {},
      errors: [{ urlPart: 'expired-delta', status: 410 }],
    });
    const cursorIn: TeamsCursor = {
      'channel-team-1:ch-1': {
        phase: 'delta',
        deltaLink: 'https://graph/expired-delta',
      },
    };
    const { cursor, result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn,
      emit: async () => {},
    });
    expect(result.deltaResets).toEqual(['channel-team-1:ch-1']);
    expect(cursor['channel-team-1:ch-1']).toEqual({ phase: 'backfill' });
  });

  it('continues syncing other resources after one resource 403s', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-403', displayName: 'private', membershipType: 'private' },
          { id: 'ch-ok', displayName: 'general', membershipType: 'standard' },
        ],
      },
      chats: [],
      channelMessages: {
        'team-1/ch-ok': [
          {
            value: [msg({ id: 'root-1' })],
            '@odata.deltaLink': 'https://x/delta',
          },
        ],
      },
      chatMessages: {},
      errors: [{ urlPart: '/channels/ch-403/messages', status: 403 }],
    });
    const emissions: ResourceEmission[] = [];
    const { result } = await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn: {},
      emit: async (e) => {
        emissions.push(e);
      },
    });
    expect(result.archivedResources).toContain('channel-team-1:ch-403');
    const { threads } = collect(emissions);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.rootMessageId).toBe('root-1');
  });
});

describe('runTenantSync — cursor reuse', () => {
  it('a resource already marked archived is skipped on subsequent runs', async () => {
    const graph = makeMockGraph({
      teams: [{ id: 'team-1', displayName: 'Engineering' }],
      channelsByTeam: {
        'team-1': [
          { id: 'ch-1', displayName: 'archived-ch', membershipType: 'standard' },
        ],
      },
      chats: [],
      channelMessages: {
        // If we did call Graph it would return content — but we shouldn't.
        'team-1/ch-1': [
          {
            value: [msg({ id: 'leaked' })],
            '@odata.deltaLink': 'https://x',
          },
        ],
      },
      chatMessages: {},
    });
    const cursorIn: TeamsCursor = {
      'channel-team-1:ch-1': {
        phase: 'archived',
        removedAt: '2026-05-01T00:00:00Z',
      },
    };
    const emissions: ResourceEmission[] = [];
    await runTenantSync({
      graph,
      tenantId: 'tenant-a',
      cursorIn,
      emit: async (e) => {
        emissions.push(e);
      },
    });
    expect(collect(emissions).threads).toHaveLength(0);
  });
});
