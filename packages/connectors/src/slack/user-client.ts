import { holoError, ErrorCode } from '@holo/errors';

export interface SlackUserApiClient {
  authTest(): Promise<{ slackUserId: string; teamId: string }>;
  usersConversations(opts?: { cursor?: string }): Promise<{
    channels: Array<{ id: string }>;
    nextCursor?: string;
  }>;
}

async function slackUserPost(
  token: string,
  method: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
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
  const json = (await res.json()) as Record<string, unknown>;
  if (!json['ok']) {
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Slack API ${method}: ${String(json['error'] ?? 'unknown')}`,
      fix: 'Check the user token and re-authenticate.',
    });
  }
  return json;
}

export function createSlackUserApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): SlackUserApiClient {
  return {
    async authTest() {
      const res = await slackUserPost(token, 'auth.test', {}, fetchImpl);
      return {
        slackUserId: String(res['user_id'] ?? ''),
        teamId: String(res['team_id'] ?? ''),
      };
    },

    async usersConversations(opts) {
      const body: Record<string, string> = {
        types: 'public_channel,private_channel,mpim,im',
        limit: '1000',
      };
      if (opts?.cursor) body['cursor'] = opts.cursor;
      const res = await slackUserPost(token, 'users.conversations', body, fetchImpl);
      const channels = (res['channels'] as Array<{ id: string }> | undefined) ?? [];
      const rawCursor =
        (res['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor;
      const nextCursor = rawCursor && rawCursor.length > 0 ? rawCursor : undefined;
      return { channels: channels.map((c) => ({ id: c.id })), nextCursor };
    },
  };
}
