import { describe, it, expect } from 'vitest';
import { resolveSlackSubjects, type SlackChannelLister } from '../src/slack-resolver';

function fakeClient(
  pages: Array<{ channels: Array<{ id: string }>; nextCursor?: string }>,
): SlackChannelLister {
  let i = 0;
  return {
    async usersConversations() {
      const p = pages[i++];
      if (!p) throw new Error('exhausted fake pages');
      return p;
    },
  };
}

describe('resolveSlackSubjects', () => {
  it('returns sorted slack-channel: subjects from a single page', async () => {
    const client = fakeClient([{ channels: [{ id: 'C2' }, { id: 'C1' }] }]);
    expect(await resolveSlackSubjects(client)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
    ]);
  });

  it('paginates via nextCursor', async () => {
    const client = fakeClient([
      { channels: [{ id: 'C1' }], nextCursor: 'next-1' },
      { channels: [{ id: 'C2' }], nextCursor: 'next-2' },
      { channels: [{ id: 'C3' }] },
    ]);
    expect(await resolveSlackSubjects(client)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
      'slack-channel:C3',
    ]);
  });

  it('dedupes channels appearing across pages', async () => {
    const client = fakeClient([
      { channels: [{ id: 'C1' }, { id: 'C2' }], nextCursor: 'p2' },
      { channels: [{ id: 'C2' }, { id: 'C3' }] },
    ]);
    expect(await resolveSlackSubjects(client)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
      'slack-channel:C3',
    ]);
  });

  it('returns empty array when user is in no channels', async () => {
    const client = fakeClient([{ channels: [] }]);
    expect(await resolveSlackSubjects(client)).toEqual([]);
  });
});
