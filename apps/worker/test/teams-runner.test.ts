import { describe, it, expect } from 'vitest';
import { __testing } from '../src/queues/teams-runner';
import type { EmittedThread } from '@holo/connectors';

const { chunksFromThread, parsePersistedCursor } = __testing;

function channelEmission(over: Partial<EmittedThread> = {}): EmittedThread {
  return {
    resourceKind: 'channel',
    resourceCursorKey: 'channel-team-1:ch-1',
    teamId: 'team-1',
    teamDisplayName: 'Engineering',
    channelId: 'ch-1',
    channelDisplayName: 'general',
    channelMembershipType: 'standard',
    rootMessageId: 'root-1',
    createdDateTime: '2026-05-15T10:00:00Z',
    webUrl: 'https://teams.microsoft.com/l/message/19:abc/root-1',
    parent: {
      id: 'root-1',
      createdDateTime: '2026-05-15T10:00:00Z',
      messageType: 'message',
      body: { contentType: 'text', content: 'hello' },
      from: { user: { id: 'aad-alice', displayName: 'Alice' } },
    },
    replies: [],
    participantAadObjectIds: ['aad-alice'],
    ...over,
  };
}

function chatEmission(over: Partial<EmittedThread> = {}): EmittedThread {
  return {
    resourceKind: 'chat',
    resourceCursorKey: 'chat-chat-z',
    chatId: 'chat-z',
    chatTopic: 'Q4 planning',
    chatType: 'group',
    rootMessageId: 'root-1',
    createdDateTime: '2026-05-15T10:00:00Z',
    webUrl: null,
    parent: {
      id: 'root-1',
      createdDateTime: '2026-05-15T10:00:00Z',
      messageType: 'message',
      body: { contentType: 'text', content: 'kick off' },
      from: { user: { id: 'aad-alice', displayName: 'Alice' } },
    },
    replies: [],
    participantAadObjectIds: ['aad-alice'],
    ...over,
  };
}

describe('parsePersistedCursor', () => {
  it('returns empty by-tenant map for null / non-object input', () => {
    expect(parsePersistedCursor(null)).toEqual({ byTenant: {} });
    expect(parsePersistedCursor('not an object')).toEqual({ byTenant: {} });
    expect(parsePersistedCursor({})).toEqual({ byTenant: {} });
  });

  it('round-trips a populated cursor through the parser', () => {
    const raw = {
      byTenant: {
        'tenant-a': {
          'channel-team-1:ch-1': {
            phase: 'delta',
            deltaLink: 'https://graph/delta',
          },
        },
        'tenant-b': {
          'chat-c-1': {
            phase: 'backfill',
            nextLink: 'https://graph/next',
          },
        },
      },
    };
    const parsed = parsePersistedCursor(raw);
    expect(parsed.byTenant['tenant-a']!['channel-team-1:ch-1']).toEqual({
      phase: 'delta',
      deltaLink: 'https://graph/delta',
    });
    expect(parsed.byTenant['tenant-b']!['chat-c-1']).toEqual({
      phase: 'backfill',
      nextLink: 'https://graph/next',
    });
  });

  it('drops malformed per-tenant cursor entries (treated as first-run)', () => {
    const parsed = parsePersistedCursor({
      byTenant: {
        'tenant-a': {
          'k': { phase: 'unknown' }, // malformed → dropped
        },
      },
    });
    expect(parsed.byTenant['tenant-a']).toEqual({});
  });
});

describe('chunksFromThread', () => {
  it('produces a teams-thread chunk with the right shape for a channel post', async () => {
    const chunks = await chunksFromThread(
      channelEmission(),
      'org-1',
      'src-1',
    );
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.kind).toBe('teams-thread');
    expect(c.provider).toBe('teams');
    expect(c.organizationId).toBe('org-1');
    expect(c.sourceId).toBe('src-1');
    expect(c.sourceArtifactId).toBe('teams-thread:team-1/ch-1/root-1');
    // Content must include the formatted message line.
    expect(c.content).toContain('@Alice');
    expect(c.content).toContain('hello');
    // ACL must scope to the team for a standard channel.
    expect(c.aclSubjects).toContain('team:team-1');
    expect(c.aclSubjects).toContain('org:org-1');
    // Content hash is computed.
    expect(c.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scopes ACL to the channel (not the team) for a PRIVATE channel', async () => {
    const chunks = await chunksFromThread(
      channelEmission({ channelMembershipType: 'private' }),
      'org-1',
      'src-1',
    );
    expect(chunks[0]!.aclSubjects).toContain('team-channel:ch-1');
    expect(chunks[0]!.aclSubjects).not.toContain('team:team-1');
  });

  it('uses chat-scoped externalId + ACL for chat threads', async () => {
    const chunks = await chunksFromThread(chatEmission(), 'org-1', 'src-1');
    const c = chunks[0]!;
    expect(c.sourceArtifactId).toBe('teams-thread:chat-z/root-1');
    expect(c.aclSubjects).toContain('chat:chat-z');
    expect(c.aclSubjects).not.toContain('team:team-1');
  });

  it('persists web_url on the chunk metadata when Graph supplied one', async () => {
    const chunks = await chunksFromThread(
      channelEmission(),
      'org-1',
      'src-1',
    );
    expect(chunks[0]!.metadata['web_url']).toBe(
      'https://teams.microsoft.com/l/message/19:abc/root-1',
    );
  });

  it('omits web_url from metadata when Graph returned null (deleted parent etc.)', async () => {
    const chunks = await chunksFromThread(
      channelEmission({ webUrl: null }),
      'org-1',
      'src-1',
    );
    expect(chunks[0]!.metadata['web_url']).toBeUndefined();
  });
});
