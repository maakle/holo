import type { Chunker, Chunk, ChunkContext } from './contract';

/**
 * One Google Chat thread's worth of messages, ready for chunking.
 *
 * `threadName` is the API resource path (`spaces/AAA/threads/BBB`) and
 * doubles as the stable artifact key. Senders carry the resource name
 * (`users/123`) plus the human display name resolved at sync time.
 */
export interface GoogleChatThreadInput {
  spaceName: string;
  spaceDisplayName: string;
  threadName: string;
  parent: { senderName: string; createTime: string; text: string };
  replies: Array<{ senderName: string; createTime: string; text: string }>;
  /** Resource names of every human participant; used for ACL subjects. */
  participantUserNames: string[];
  /** display name keyed by `users/<id>` resource name. */
  userDirectory: Map<string, string>;
}

function formatTime(rfc3339: string): string {
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatMessage(
  msg: { senderName: string; createTime: string; text: string },
  userDirectory: Map<string, string>,
): string {
  const display = userDirectory.get(msg.senderName) ?? msg.senderName;
  return `@${display} [${formatTime(msg.createTime)}]: ${msg.text}\n`;
}

export const googleChatThreadChunker: Chunker<GoogleChatThreadInput> = {
  kind: 'google-chat-thread',
  embeddingModel: 'openai-3-small',
  async chunk(input: GoogleChatThreadInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `google-chat-thread:${input.threadName}`;
    const aclSubjects = [
      `org:${ctx.organizationId}`,
      // Space resource name as the access boundary — Google Chat's space
      // membership is the only signal we have without a workspace-admin scope.
      `google-chat-space:${input.spaceName}`,
    ];

    const sortedReplies = [...input.replies].sort(
      (a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime(),
    );
    const lines = [formatMessage(input.parent, input.userDirectory)];
    for (const reply of sortedReplies) {
      lines.push(formatMessage(reply, input.userDirectory));
    }

    return [
      {
        content: lines.join(''),
        parentExternalId,
        metadata: {
          space_name: input.spaceName,
          space_display_name: input.spaceDisplayName,
          thread_name: input.threadName,
          participant_user_names: input.participantUserNames,
          parent_create_time: input.parent.createTime,
        },
        aclSubjects,
      },
    ];
  },
};
