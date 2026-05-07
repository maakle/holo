/**
 * Slack API client built on Slack's POST /api/<method> form-urlencoded
 * surface. Owns its own rate-limit pacing and 429 retry budget — Slack's
 * tier-3 endpoints (conversations.history/replies) require careful pacing
 * that's hard to express through the framework's generic token bucket.
 *
 * This client is consumed by:
 *   - the framework's Slack spec (for sync)
 *   - the worker's Slack bot (for chatPostMessage / chatUpdate / etc)
 *   - the gateway's slash-command and event-subscription routes (indirectly)
 */
import type {
  SlackBlock,
  SlackChannel,
  SlackMember,
  SlackMessage,
  SlackPostMessageInput,
  SlackPostMessageResult,
} from './types';

export type {
  SlackBlock,
  SlackChannel,
  SlackMember,
  SlackMessage,
  SlackPostMessageInput,
  SlackPostMessageResult,
};

export interface SlackApiClient {
  /** GET-equivalent for `auth.test` — returns workspace identity for testConnection. */
  authTest(): Promise<{ team_id: string; team: string; user_id?: string }>;
  usersList(): Promise<SlackMember[]>;
  /**
   * Channels the bot user is currently a member of (public + private).
   * Used by the default-all sync fallback when no allowlist is configured.
   */
  listMemberChannels(): Promise<SlackChannel[]>;
  conversationsInfo(channelId: string): Promise<SlackChannel | null>;
  conversationsHistory(
    channelId: string,
    opts: { oldest: string; cursor?: string },
  ): Promise<{ messages: SlackMessage[]; nextCursor?: string }>;
  conversationsReplies(
    channelId: string,
    ts: string,
  ): Promise<SlackMessage[]>;
  /**
   * Post a message back to a channel, DM, or thread. Returns the channel and
   * `ts` so callers can chatUpdate the same message later (e.g. replacing a
   * "Thinking…" placeholder with the real answer).
   */
  chatPostMessage(input: SlackPostMessageInput): Promise<SlackPostMessageResult>;
  /**
   * Replace the content of a previously-posted message. `ts` must be the
   * value returned from chatPostMessage; the bot can only edit its own posts.
   */
  chatUpdate(input: {
    channel: string;
    ts: string;
    text: string;
    blocks?: SlackBlock[];
  }): Promise<SlackPostMessageResult>;
  /**
   * Open or fetch the IM channel ID for a user. Required before posting a DM —
   * Slack does not allow posting directly to a user ID.
   */
  conversationsOpen(userId: string): Promise<string | null>;
}

/**
 * Max wall-clock time we'll sit retrying a single rate-limited call. Slack's
 * Retry-After can be tens of seconds; capping the sum prevents a single
 * bad burst from blocking the whole sync indefinitely.
 */
const RATE_LIMIT_TOTAL_BUDGET_MS = 65 * 1000;
const MAX_RATE_LIMIT_RETRIES = 5;

/**
 * Proactive pacing — Slack's hottest tier (Tier 3: conversations.history,
 * conversations.replies) caps at ~50 requests/minute per workspace. Targeting
 * 40 req/min (= one call every 1500ms) leaves headroom and avoids triggering
 * 429s in the first place. The retry path in slackPost is the safety net,
 * not the primary mechanism.
 *
 * Bucket is keyed by token (= workspace) so different workspaces don't
 * starve each other. In-process only; when we scale to multiple workers
 * we'll move this to Redis.
 */
const MIN_INTERVAL_MS = 1500;
const lastCallAt = new Map<string, number>();

async function paceFor(token: string): Promise<void> {
  const now = Date.now();
  const last = lastCallAt.get(token) ?? 0;
  const waitMs = last + MIN_INTERVAL_MS - now;
  // Reserve our slot eagerly so concurrent callers serialize cleanly.
  const slotAt = waitMs > 0 ? last + MIN_INTERVAL_MS : now;
  lastCallAt.set(token, slotAt);
  if (waitMs > 0) await sleep(waitMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function slackPost(
  token: string,
  method: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(body);
  const start = Date.now();
  let attempt = 0;
  while (true) {
    await paceFor(token);
    const res = await fetchImpl(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    // Slack signals rate limits via HTTP 429 with a Retry-After header AND
    // (for some endpoints) via 200 OK + { ok: false, error: 'ratelimited' }.
    // Handle both — Slack's docs are inconsistent across endpoints.
    const retryAfterHeader = res.headers.get('retry-after');
    const status = res.status;
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.clone().json()) as Record<string, unknown>;
    } catch {
      // non-JSON response; will surface as a normal error below
    }

    const isRateLimited =
      status === 429 ||
      (json && json['ok'] === false && json['error'] === 'ratelimited');

    if (!isRateLimited) {
      return json ?? ((await res.json()) as Record<string, unknown>);
    }

    if (
      attempt >= MAX_RATE_LIMIT_RETRIES ||
      Date.now() - start >= RATE_LIMIT_TOTAL_BUDGET_MS
    ) {
      // Give up and let the caller see the ratelimited error so the job
      // surfaces in the sync history with an honest reason.
      return (
        json ?? {
          ok: false,
          error: 'ratelimited',
        }
      );
    }

    const retrySeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const baseDelayMs = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? retrySeconds * 1000
      : 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s, 16s
    // Add 0–250ms jitter so parallel calls don't unblock simultaneously.
    const delay = Math.min(
      baseDelayMs + Math.floor(Math.random() * 250),
      RATE_LIMIT_TOTAL_BUDGET_MS - (Date.now() - start),
    );
    if (delay <= 0) {
      return json ?? { ok: false, error: 'ratelimited' };
    }
    await sleep(delay);
    attempt += 1;
  }
}

export function createSlackApiClient(
  token: string,
  fetchImpl: typeof fetch = fetch,
): SlackApiClient {
  return {
    async authTest() {
      const res = await slackPost(token, 'auth.test', {}, fetchImpl);
      if (!res['ok']) {
        throw Object.assign(new Error(`auth.test error: ${res['error']}`), {
          data: { error: res['error'] },
        });
      }
      return {
        team_id: (res['team_id'] as string) ?? '',
        team: (res['team'] as string) ?? '',
        user_id: res['user_id'] as string | undefined,
      };
    },

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

    async listMemberChannels() {
      const out: SlackChannel[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        pages += 1;
        const body: Record<string, string> = {
          limit: '200',
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
        };
        if (cursor) body['cursor'] = cursor;
        const res = await slackPost(token, 'conversations.list', body, fetchImpl);
        if (!res['ok']) {
          throw Object.assign(new Error(`conversations.list error: ${res['error']}`), {
            data: { error: res['error'] },
          });
        }
        const list = (res['channels'] as SlackChannel[] | undefined) ?? [];
        for (const c of list) {
          if (c.is_member) out.push(c);
        }
        cursor =
          (res['response_metadata'] as { next_cursor?: string } | undefined)?.next_cursor ||
          undefined;
        if (pages >= 10) break;
      } while (cursor);
      return out;
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

    async chatPostMessage(input) {
      const body: Record<string, string> = {
        channel: input.channel,
        text: input.text,
      };
      if (input.thread_ts) body['thread_ts'] = input.thread_ts;
      // Slack accepts `blocks` as a JSON-encoded string when the request is
      // form-urlencoded (which slackPost uses for consistent rate-limit handling).
      if (input.blocks) body['blocks'] = JSON.stringify(input.blocks);
      if (input.unfurl_links === false) body['unfurl_links'] = 'false';
      if (input.unfurl_media === false) body['unfurl_media'] = 'false';
      const res = await slackPost(token, 'chat.postMessage', body, fetchImpl);
      return {
        ok: res['ok'] === true,
        channel: res['channel'] as string | undefined,
        ts: res['ts'] as string | undefined,
        error: res['error'] as string | undefined,
      };
    },

    async chatUpdate(input) {
      const body: Record<string, string> = {
        channel: input.channel,
        ts: input.ts,
        text: input.text,
      };
      if (input.blocks) body['blocks'] = JSON.stringify(input.blocks);
      const res = await slackPost(token, 'chat.update', body, fetchImpl);
      return {
        ok: res['ok'] === true,
        channel: res['channel'] as string | undefined,
        ts: res['ts'] as string | undefined,
        error: res['error'] as string | undefined,
      };
    },

    async conversationsOpen(userId) {
      const res = await slackPost(
        token,
        'conversations.open',
        { users: userId },
        fetchImpl,
      );
      if (!res['ok']) return null;
      const channel = res['channel'] as { id?: string } | undefined;
      return channel?.id ?? null;
    },
  };
}
