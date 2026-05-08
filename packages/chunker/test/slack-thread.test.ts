import { describe, it, expect } from 'vitest';
import { slackThreadChunker, type SlackThreadInput } from '../src/slack-thread';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function baseThread(overrides: Partial<SlackThreadInput> = {}): SlackThreadInput {
  return {
    channelId: 'C123',
    channelName: 'eng',
    threadTs: '1700000000.000000',
    parent: { user: 'U1', ts: '1700000000.000000', text: 'parent message' },
    replies: [
      { user: 'U2', ts: '1700000010.000000', text: 'first reply' },
      { user: 'U3', ts: '1700000020.000000', text: 'second reply' },
      { user: 'U4', ts: '1700000030.000000', text: 'third reply' },
    ],
    participantUserIds: ['U1', 'U2', 'U3', 'U4'],
    permalink: 'https://acme.slack.com/archives/C123/p1700000000',
    userDirectory: new Map([
      ['U1', 'Alice'],
      ['U2', 'Bob'],
      ['U3', 'Carol'],
      ['U4', 'Dave'],
    ]),
    ...overrides,
  };
}

describe('slackThreadChunker', () => {
  it('1 parent + 3 replies → 1 chunk with 4 @-prefixed lines in ts order', async () => {
    const chunks = await slackThreadChunker.chunk(baseThread(), ctx);
    expect(chunks).toHaveLength(1);
    const lines = chunks[0]!.content.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^@Alice .*: parent message$/);
    expect(lines[1]).toMatch(/^@Bob .*: first reply$/);
    expect(lines[2]).toMatch(/^@Carol .*: second reply$/);
    expect(lines[3]).toMatch(/^@Dave .*: third reply$/);
  });

  it('userDirectory missing → uses raw user id', async () => {
    const thread = baseThread({
      userDirectory: new Map([['U1', 'Alice']]), // missing U2/U3/U4
    });
    const chunks = await slackThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('@Alice');
    expect(chunks[0]!.content).toContain('@U2');
    expect(chunks[0]!.content).toContain('@U3');
  });

  it('time format: ts 1700000000.000000 → [22:13] UTC (date == 2023-11-14T22:13:20Z)', async () => {
    const thread = baseThread({
      replies: [],
      parent: { user: 'U1', ts: '1700000000.000000', text: 'hi' },
    });
    const chunks = await slackThreadChunker.chunk(thread, ctx);
    expect(chunks[0]!.content).toContain('[22:13]');
  });

  it('aclSubjects length 2 in documented order; parentExternalId matches spec', async () => {
    const chunks = await slackThreadChunker.chunk(baseThread(), ctx);
    expect(chunks[0]!.aclSubjects).toEqual(['org:org-1', 'slack-channel:C123']);
    expect(chunks[0]!.parentExternalId).toBe('slack-thread:C123:1700000000.000000');
  });

  it('participant_user_ids and permalink in metadata verbatim', async () => {
    const chunks = await slackThreadChunker.chunk(baseThread(), ctx);
    expect(chunks[0]!.metadata.participant_user_ids).toEqual(['U1', 'U2', 'U3', 'U4']);
    expect(chunks[0]!.metadata.permalink).toBe('https://acme.slack.com/archives/C123/p1700000000');
  });
});
