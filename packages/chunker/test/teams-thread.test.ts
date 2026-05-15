import { describe, it, expect } from 'vitest';
import {
  teamsThreadChunker,
  stripHtmlBody,
  type TeamsThreadInput,
  type TeamsMessageInput,
} from '../src/teams-thread';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function msg(overrides: Partial<TeamsMessageInput>): TeamsMessageInput {
  return {
    id: 'm-default',
    createdDateTime: '2026-05-15T10:00:00Z',
    fromUserId: 'aad-default',
    fromDisplayName: 'Default User',
    bodyContentType: 'text',
    bodyContent: 'default body',
    ...overrides,
  };
}

function channelThread(
  overrides: Partial<TeamsThreadInput> = {},
): TeamsThreadInput {
  return {
    resourceKind: 'channel',
    teamId: 'team-aad-id',
    teamDisplayName: 'Engineering',
    channelId: 'channel-1',
    channelDisplayName: 'general',
    channelMembershipType: 'standard',
    rootMessageId: 'root-msg-1',
    createdDateTime: '2026-05-15T10:00:00Z',
    webUrl:
      'https://teams.microsoft.com/l/message/19:abc@thread.tacv2/root-msg-1',
    parent: msg({
      id: 'root-msg-1',
      createdDateTime: '2026-05-15T10:00:00Z',
      fromUserId: 'aad-alice',
      fromDisplayName: 'Alice',
      bodyContent: 'parent post',
    }),
    replies: [
      msg({
        id: 'r1',
        createdDateTime: '2026-05-15T10:01:00Z',
        fromUserId: 'aad-bob',
        fromDisplayName: 'Bob',
        bodyContent: 'first reply',
      }),
      msg({
        id: 'r2',
        createdDateTime: '2026-05-15T10:02:00Z',
        fromUserId: 'aad-carol',
        fromDisplayName: 'Carol',
        bodyContent: 'second reply',
      }),
    ],
    participantAadObjectIds: ['aad-alice', 'aad-bob', 'aad-carol'],
    userDirectory: new Map([
      ['aad-alice', 'Alice'],
      ['aad-bob', 'Bob'],
      ['aad-carol', 'Carol'],
    ]),
    ...overrides,
  };
}

function chatThread(
  overrides: Partial<TeamsThreadInput> = {},
): TeamsThreadInput {
  return {
    resourceKind: 'chat',
    chatId: 'chat-xyz',
    chatTopic: 'Q4 planning',
    chatType: 'group',
    rootMessageId: 'root-msg-1',
    createdDateTime: '2026-05-15T10:00:00Z',
    webUrl: 'https://teams.microsoft.com/l/chat/chat-xyz/0',
    parent: msg({
      id: 'root-msg-1',
      fromUserId: 'aad-alice',
      fromDisplayName: 'Alice',
      bodyContent: 'kick off',
    }),
    replies: [],
    participantAadObjectIds: ['aad-alice'],
    userDirectory: new Map([['aad-alice', 'Alice']]),
    ...overrides,
  };
}

describe('teamsThreadChunker — channel posts', () => {
  it('1 parent + 2 replies → 1 chunk with 3 @-prefixed lines in time order', async () => {
    const chunks = await teamsThreadChunker.chunk(channelThread(), ctx);
    expect(chunks).toHaveLength(1);
    const lines = chunks[0]!.content.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^@Alice \[10:00\]: parent post$/);
    expect(lines[1]).toMatch(/^@Bob \[10:01\]: first reply$/);
    expect(lines[2]).toMatch(/^@Carol \[10:02\]: second reply$/);
  });

  it('sorts replies by createdDateTime even when input is out of order', async () => {
    const thread = channelThread({
      replies: [
        msg({
          id: 'r-late',
          createdDateTime: '2026-05-15T10:05:00Z',
          fromUserId: 'aad-z',
          fromDisplayName: 'Zoe',
          bodyContent: 'late',
        }),
        msg({
          id: 'r-early',
          createdDateTime: '2026-05-15T10:01:00Z',
          fromUserId: 'aad-bob',
          fromDisplayName: 'Bob',
          bodyContent: 'early',
        }),
      ],
    });
    const chunks = await teamsThreadChunker.chunk(thread, ctx);
    const lines = chunks[0]!.content.trimEnd().split('\n');
    expect(lines[1]).toContain('early');
    expect(lines[2]).toContain('late');
  });

  it('ACL for a STANDARD channel scopes to the team', async () => {
    const chunks = await teamsThreadChunker.chunk(channelThread(), ctx);
    expect(chunks[0]!.aclSubjects).toEqual([
      'org:org-1',
      'team:team-aad-id',
    ]);
  });

  it('ACL for a PRIVATE channel scopes to the channel, NOT the team', async () => {
    // A non-channel-member who's still in the parent team must not be
    // able to retrieve private-channel content. Channel-level ACL is the
    // tighter envelope.
    const chunks = await teamsThreadChunker.chunk(
      channelThread({ channelMembershipType: 'private' }),
      ctx,
    );
    expect(chunks[0]!.aclSubjects).toEqual([
      'org:org-1',
      'team-channel:channel-1',
    ]);
    expect(chunks[0]!.aclSubjects).not.toContain('team:team-aad-id');
  });

  it('persists the webUrl on metadata for url-fn lookup', async () => {
    const chunks = await teamsThreadChunker.chunk(channelThread(), ctx);
    expect(chunks[0]!.metadata['web_url']).toBe(
      'https://teams.microsoft.com/l/message/19:abc@thread.tacv2/root-msg-1',
    );
  });

  it('parentExternalId encodes team+channel+root for cross-source dedupe', async () => {
    const chunks = await teamsThreadChunker.chunk(channelThread(), ctx);
    expect(chunks[0]!.parentExternalId).toBe(
      'teams-thread:team-aad-id/channel-1/root-msg-1',
    );
  });
});

describe('teamsThreadChunker — chat threads', () => {
  it('ACL for chats scopes to the chat id, not the team', async () => {
    const chunks = await teamsThreadChunker.chunk(chatThread(), ctx);
    expect(chunks[0]!.aclSubjects).toEqual(['org:org-1', 'chat:chat-xyz']);
  });

  it('parentExternalId for chats uses chatId/rootMessageId', async () => {
    const chunks = await teamsThreadChunker.chunk(chatThread(), ctx);
    expect(chunks[0]!.parentExternalId).toBe('teams-thread:chat-xyz/root-msg-1');
  });

  it('persists chatType + chatTopic on metadata', async () => {
    const chunks = await teamsThreadChunker.chunk(chatThread(), ctx);
    expect(chunks[0]!.metadata['chat_type']).toBe('group');
    expect(chunks[0]!.metadata['chat_topic']).toBe('Q4 planning');
  });

  it('handles a null chatTopic (1:1 chats often have no topic)', async () => {
    const chunks = await teamsThreadChunker.chunk(
      chatThread({ chatTopic: null, chatType: 'oneOnOne' }),
      ctx,
    );
    expect(chunks[0]!.metadata['chat_topic']).toBeNull();
  });
});

describe('teamsThreadChunker — HTML body handling', () => {
  it('strips simple tags from html bodies', async () => {
    const thread = channelThread({
      parent: msg({
        id: 'root-msg-1',
        fromUserId: 'aad-alice',
        fromDisplayName: 'Alice',
        bodyContentType: 'html',
        bodyContent: '<p>Hello <b>world</b>!</p>',
      }),
      replies: [],
    });
    const chunks = await teamsThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('Hello world!');
    expect(chunks[0]!.content).not.toContain('<p>');
    expect(chunks[0]!.content).not.toContain('<b>');
  });

  it('drops <script> / <style> blocks entirely (defense in depth)', () => {
    const stripped = stripHtmlBody(
      'safe <script>alert(1)</script> and <style>body{}</style> trailing',
    );
    expect(stripped).toBe('safe and trailing');
  });

  it('decodes the common HTML entities', () => {
    expect(stripHtmlBody('a &amp; b &lt;c&gt; &quot;d&quot;')).toBe(
      'a & b <c> "d"',
    );
  });

  it('converts <br> and block tags to line breaks', () => {
    expect(stripHtmlBody('one<br>two<br/>three<p>four</p>five')).toBe(
      'one\ntwo\nthree\nfour\nfive',
    );
  });
});

describe('teamsThreadChunker — user directory fallback', () => {
  it('uses fromDisplayName when present, even if userDirectory has nothing', async () => {
    const thread = channelThread({
      userDirectory: new Map(), // empty
    });
    const chunks = await teamsThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('@Alice');
    expect(chunks[0]!.content).toContain('@Bob');
  });

  it('falls back to AAD oid when neither fromDisplayName nor directory hits', async () => {
    const thread = channelThread({
      parent: msg({
        id: 'root-msg-1',
        fromUserId: 'aad-stranger',
        fromDisplayName: undefined,
        bodyContent: 'who am i',
      }),
      replies: [],
      userDirectory: new Map(),
    });
    const chunks = await teamsThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('@aad-stranger');
  });

  it('falls back to "app" when the message is application-authored (no user id)', async () => {
    const thread = channelThread({
      parent: msg({
        id: 'root-msg-1',
        fromUserId: undefined,
        fromDisplayName: undefined,
        bodyContent: 'bot-authored',
      }),
      replies: [],
    });
    const chunks = await teamsThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('@app');
  });
});
