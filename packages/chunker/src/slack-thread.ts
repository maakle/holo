import type { Chunker, Chunk, ChunkContext } from './contract';

export interface SlackThreadInput {
  channelId: string;
  channelName: string;
  threadTs: string;
  parent: { user: string; ts: string; text: string };
  replies: Array<{ user: string; ts: string; text: string }>;
  participantUserIds: string[];
  permalink: string;
  userDirectory: Map<string, string>;
}

function formatTs(ts: string): string {
  const sec = parseFloat(ts);
  const d = new Date(sec * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatMessage(
  msg: { user: string; ts: string; text: string },
  userDirectory: Map<string, string>,
): string {
  const realName = userDirectory.get(msg.user) ?? msg.user;
  return `@${realName} [${formatTs(msg.ts)}]: ${msg.text}\n`;
}

export const slackThreadChunker: Chunker<SlackThreadInput> = {
  kind: 'slack-thread',
  embeddingModel: 'openai-3-small',
  async chunk(input: SlackThreadInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `slack-thread:${input.channelId}:${input.threadTs}`;
    const aclSubjects = [
      `org:${ctx.organizationId}`,
      `slack-channel:${input.channelId}`,
    ];

    const sortedReplies = [...input.replies].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
    const lines = [formatMessage(input.parent, input.userDirectory)];
    for (const reply of sortedReplies) {
      lines.push(formatMessage(reply, input.userDirectory));
    }

    return [
      {
        content: lines.join(''),
        parentExternalId,
        metadata: {
          channel_id: input.channelId,
          channel_name: input.channelName,
          thread_ts: input.threadTs,
          participant_user_ids: input.participantUserIds,
          permalink: input.permalink,
        },
        aclSubjects,
      },
    ];
  },
};
