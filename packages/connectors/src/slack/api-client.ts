export interface SlackMember {
  id: string;
  real_name: string;
  is_bot: boolean;
  name?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  reply_count?: number;
}

export interface SlackApiClient {
  usersList(): Promise<SlackMember[]>;
  conversationsInfo(channelId: string): Promise<SlackChannel | null>;
  conversationsHistory(
    channelId: string,
    opts: { oldest: string; cursor?: string },
  ): Promise<{ messages: SlackMessage[]; nextCursor?: string }>;
  conversationsReplies(
    channelId: string,
    ts: string,
  ): Promise<SlackMessage[]>;
}

async function slackPost(
  token: string,
  method: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(body);
  const res = await fetchImpl(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export function createSlackApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): SlackApiClient {
  return {
    async usersList() {
      const members: SlackMember[] = [];
      let cursor: string | undefined;
      do {
        const body: Record<string, string> = { limit: '200' };
        if (cursor) body['cursor'] = cursor;
        const res = await slackPost(token, 'users.list', body, fetchImpl);
        const list = (res['members'] as SlackMember[] | undefined) ?? [];
        members.push(...list);
        cursor = (res['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor || undefined;
      } while (cursor);
      return members;
    },

    async conversationsInfo(channelId) {
      const res = await slackPost(token, 'conversations.info', { channel: channelId }, fetchImpl);
      if (!res['ok']) return null;
      return res['channel'] as SlackChannel;
    },

    async conversationsHistory(channelId, opts) {
      const body: Record<string, string> = { channel: channelId, oldest: opts.oldest, limit: '200' };
      if (opts.cursor) body['cursor'] = opts.cursor;
      const res = await slackPost(token, 'conversations.history', body, fetchImpl);
      if (!res['ok']) {
        throw Object.assign(new Error(`conversations.history error: ${res['error']}`), {
          data: { error: res['error'] },
        });
      }
      return {
        messages: (res['messages'] as SlackMessage[] | undefined) ?? [],
        nextCursor:
          (res['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor ||
          undefined,
      };
    },

    async conversationsReplies(channelId, ts) {
      const res = await slackPost(
        token,
        'conversations.replies',
        { channel: channelId, ts, limit: '200' },
        fetchImpl,
      );
      return (res['messages'] as SlackMessage[] | undefined) ?? [];
    },
  };
}
