import { describe, it, expect, vi } from 'vitest';
import {
  resolveTeamsSubjects,
  type TeamsSubjectsGraphClient,
} from '../src/teams-resolver';

const ALICE = 'aad-alice';
const BOB = 'aad-bob';

interface Fixture {
  teams: Array<{ id: string; members: string[] }>;
  chats: Array<{ id: string; members: string[] }>;
  /** Force `listTeamMembers` to throw for these team ids (simulates 403). */
  forbiddenTeams?: string[];
  forbiddenChats?: string[];
  /** Make `listChats` itself throw. */
  listChatsFails?: boolean;
}

function makeGraph(f: Fixture): TeamsSubjectsGraphClient {
  return {
    async listJoinedTeams() {
      return f.teams.map((t) => ({ id: t.id }));
    },
    async listTeamMembers(teamId) {
      if (f.forbiddenTeams?.includes(teamId)) {
        throw new Error(`${teamId} 403`);
      }
      const team = f.teams.find((t) => t.id === teamId);
      return (team?.members ?? []).map((userId) => ({ userId }));
    },
    async listChats() {
      if (f.listChatsFails) throw new Error('chats listing failed');
      return { value: f.chats.map((c) => ({ id: c.id })) };
    },
    async listChatMembers(chatId) {
      if (f.forbiddenChats?.includes(chatId)) {
        throw new Error(`${chatId} 403`);
      }
      const chat = f.chats.find((c) => c.id === chatId);
      return (chat?.members ?? []).map((userId) => ({ userId }));
    },
  };
}

describe('resolveTeamsSubjects', () => {
  it('returns team: + chat: subjects for resources the user is a member of', async () => {
    const graph = makeGraph({
      teams: [
        { id: 'team-1', members: [ALICE, BOB] },
        { id: 'team-2', members: [BOB] }, // Alice not in this team
      ],
      chats: [
        { id: 'chat-x', members: [ALICE, BOB] },
        { id: 'chat-y', members: [BOB] }, // Alice not in this chat
      ],
    });
    expect(await resolveTeamsSubjects({ graph, aadObjectId: ALICE })).toEqual([
      'chat:chat-x',
      'team:team-1',
    ]);
  });

  it('returns an empty list for a user who is in nothing', async () => {
    const graph = makeGraph({
      teams: [{ id: 'team-1', members: [BOB] }],
      chats: [{ id: 'chat-x', members: [BOB] }],
    });
    const stranger = 'aad-stranger-not-in-anything';
    expect(await resolveTeamsSubjects({ graph, aadObjectId: stranger })).toEqual(
      [],
    );
  });

  it('dedupes — same team listed twice returns one subject', async () => {
    const graph = makeGraph({
      teams: [
        { id: 'team-1', members: [ALICE] },
        // Defensive: Graph shouldn't return duplicates but if it did, the
        // Set dedup keeps the output stable.
        { id: 'team-1', members: [ALICE] },
      ],
      chats: [],
    });
    const out = await resolveTeamsSubjects({ graph, aadObjectId: ALICE });
    expect(out.filter((s) => s === 'team:team-1')).toHaveLength(1);
  });

  it('returns subjects sorted (stable for hash-keyed comparisons)', async () => {
    const graph = makeGraph({
      teams: [
        { id: 'team-z', members: [ALICE] },
        { id: 'team-a', members: [ALICE] },
      ],
      chats: [
        { id: 'chat-z', members: [ALICE] },
        { id: 'chat-a', members: [ALICE] },
      ],
    });
    const out = await resolveTeamsSubjects({ graph, aadObjectId: ALICE });
    expect(out).toEqual([
      'chat:chat-a',
      'chat:chat-z',
      'team:team-a',
      'team:team-z',
    ]);
  });

  it('skips a team whose membership call 403s, continues with the rest', async () => {
    // Bot was removed from team-1 mid-resolve — don't let it abort the
    // whole sync. team-2 should still appear in the output.
    const graph = makeGraph({
      teams: [
        { id: 'team-1', members: [ALICE] },
        { id: 'team-2', members: [ALICE] },
      ],
      chats: [],
      forbiddenTeams: ['team-1'],
    });
    expect(await resolveTeamsSubjects({ graph, aadObjectId: ALICE })).toEqual([
      'team:team-2',
    ]);
  });

  it('skips a chat whose membership call fails, continues with the rest', async () => {
    const graph = makeGraph({
      teams: [],
      chats: [
        { id: 'chat-1', members: [ALICE] },
        { id: 'chat-2', members: [ALICE] },
      ],
      forbiddenChats: ['chat-1'],
    });
    expect(await resolveTeamsSubjects({ graph, aadObjectId: ALICE })).toEqual([
      'chat:chat-2',
    ]);
  });

  it('returns team subjects when listChats itself fails (degraded mode)', async () => {
    // If chat listing fails entirely (transient Graph issue), still emit
    // the teams half rather than dropping all subjects.
    const graph = makeGraph({
      teams: [{ id: 'team-1', members: [ALICE] }],
      chats: [],
      listChatsFails: true,
    });
    expect(await resolveTeamsSubjects({ graph, aadObjectId: ALICE })).toEqual([
      'team:team-1',
    ]);
  });

  it('does not emit team-channel:<id> subjects for private channels (deferred)', async () => {
    // The chunker emits `team-channel:<id>` for private-channel content
    // (see PR #203). Until the Graph client exposes
    // `listChannelMembers`, this resolver only emits team-scoped
    // subjects, which means retrieval falls back to "not in this
    // user's subjects" for private channels — the safer failure mode.
    // This test pins the behavior so a future enabling-PR has a clear
    // change-detector.
    const graph = makeGraph({
      teams: [{ id: 'team-1', members: [ALICE] }],
      chats: [],
    });
    const out = await resolveTeamsSubjects({ graph, aadObjectId: ALICE });
    expect(out.some((s) => s.startsWith('team-channel:'))).toBe(false);
  });

  it('calls listJoinedTeams + listChats exactly once per run', async () => {
    const graph = makeGraph({
      teams: [{ id: 'team-1', members: [ALICE] }],
      chats: [{ id: 'chat-1', members: [ALICE] }],
    });
    const listJoined = vi.spyOn(graph, 'listJoinedTeams');
    const listChats = vi.spyOn(graph, 'listChats');
    await resolveTeamsSubjects({ graph, aadObjectId: ALICE });
    expect(listJoined).toHaveBeenCalledTimes(1);
    expect(listChats).toHaveBeenCalledTimes(1);
  });
});
