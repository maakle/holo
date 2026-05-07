/**
 * Slack channel → thread chunks projection.
 *
 * Iterates allowed channels, walks `conversations.history` pages, processes
 * each thread parent, fetches replies for that thread, runs the result
 * through @holo/chunker's slackThreadChunker, and emits chunks via
 * ctx.upsert. Per-channel cursor watermarks (`oldest_per_channel`) and
 * skipped-channel list (`bot_not_in_channel`) live on the resource cursor
 * so resumed syncs pick up where they left off.
 */
import { slackThreadChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { SlackApiClient } from './api';
import type { SlackMessage } from './types';

const AUTOMATION_USER_NAMES = new Set([
  'github',
  'pagerduty',
  'circleci',
  'linear',
  'dependabot',
]);

interface UserInfo {
  realName: string;
  isBot: boolean;
}

export interface ThreadsCursor {
  oldestPerChannel: Record<string, string>;
  botNotInChannel: string[];
}

export async function processChannels(input: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  client: SlackApiClient;
  allowedChannelIds: ReadonlyArray<string>;
}): Promise<ThreadsCursor> {
  const { ctx, client, allowedChannelIds } = input;
  const oldestPerChannel: Record<string, string> = {
    ...(ctx.cursor.oldestPerChannel ?? {}),
  };
  const botNotInChannel: string[] = [...(ctx.cursor.botNotInChannel ?? [])];

  ctx.reportProgress?.({
    current: 0,
    total: allowedChannelIds.length,
    message: 'Loading workspace users…',
  });
  const userMap = await buildUserMap(client);

  for (let channelIdx = 0; channelIdx < allowedChannelIds.length; channelIdx += 1) {
    ctx.signal?.throwIfAborted();
    const channelId = allowedChannelIds[channelIdx]!;
    const channel = await client.conversationsInfo(channelId);
    if (!channel) continue;

    ctx.reportProgress?.({
      current: channelIdx + 1,
      total: allowedChannelIds.length,
      message: `#${channel.name} · scanning…`,
    });

    const result = await processOneChannel({
      ctx,
      client,
      channelId,
      channelName: channel.name,
      oldest: oldestPerChannel[channelId] ?? '0',
      userMap,
    });

    if (result.kind === 'bot_not_invited') {
      if (!botNotInChannel.includes(channelId)) botNotInChannel.push(channelId);
    } else if (result.maxTsSeen !== oldestPerChannel[channelId]) {
      // Advance cursor by 1µs so the next incremental excludes this timestamp.
      oldestPerChannel[channelId] = (parseFloat(result.maxTsSeen) + 0.000001).toFixed(6);
    }

    // Per-channel checkpoint so a mid-sync crash resumes at a channel
    // boundary instead of replaying the whole sweep.
    await ctx.flushCursor({ oldestPerChannel, botNotInChannel });
  }

  return { oldestPerChannel, botNotInChannel };
}

async function processOneChannel(args: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  client: SlackApiClient;
  channelId: string;
  channelName: string;
  oldest: string;
  userMap: Map<string, UserInfo>;
}): Promise<
  | { kind: 'ok'; maxTsSeen: string }
  | { kind: 'bot_not_invited' }
> {
  const { ctx, client, channelId, channelName, oldest, userMap } = args;
  let maxTsSeen = oldest;
  let nextCursor: string | undefined;
  let pageNum = 0;

  do {
    ctx.signal?.throwIfAborted();
    pageNum += 1;
    let page: Awaited<ReturnType<SlackApiClient['conversationsHistory']>>;
    try {
      page = await client.conversationsHistory(channelId, { oldest, cursor: nextCursor });
    } catch (err) {
      const code = (err as { data?: { error?: string } }).data?.error;
      if (code === 'not_in_channel') return { kind: 'bot_not_invited' };
      throw err;
    }

    const parentsThisPage = page.messages.filter((m) => {
      if (isBot(m, userMap)) return false;
      return !m.thread_ts || m.thread_ts === m.ts;
    });

    let parentIdx = 0;
    for (const msg of page.messages) {
      ctx.signal?.throwIfAborted();
      if (isBot(msg, userMap)) continue;
      const ts = msg.ts;
      if (ts > maxTsSeen) maxTsSeen = ts;

      const isParent = !msg.thread_ts || msg.thread_ts === ts;
      if (!isParent) continue;
      parentIdx += 1;

      ctx.reportProgress?.({
        current: 0,
        total: null,
        message: `#${channelName} · page ${pageNum} · thread ${parentIdx}/${parentsThisPage.length}`,
      });

      await emitThread({ ctx, client, channelId, channelName, msg, userMap });
    }

    nextCursor = page.nextCursor;
  } while (nextCursor);

  return { kind: 'ok', maxTsSeen };
}

async function emitThread(args: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  client: SlackApiClient;
  channelId: string;
  channelName: string;
  msg: SlackMessage;
  userMap: Map<string, UserInfo>;
}): Promise<void> {
  const { ctx, client, channelId, channelName, msg, userMap } = args;
  const threadTs = msg.ts;

  let parent: { user: string; ts: string; text: string };
  let replies: Array<{ user: string; ts: string; text: string }> = [];
  if (msg.reply_count && msg.reply_count > 0) {
    const all = (await client.conversationsReplies(channelId, threadTs))
      .filter((m) => !isBot(m, userMap))
      .map((m) => ({ user: m.user ?? '', ts: m.ts, text: m.text ?? '' }));
    parent = all[0] ?? { user: msg.user ?? '', ts: msg.ts, text: msg.text ?? '' };
    replies = all.slice(1);
  } else {
    parent = { user: msg.user ?? '', ts: msg.ts, text: msg.text ?? '' };
  }

  const sourceArtifactId = `slack-thread:${channelId}:${threadTs}`;
  const userDirectory = new Map(
    [...userMap.entries()].map(([id, info]) => [id, info.realName]),
  );
  const rawChunks = await slackThreadChunker.chunk(
    {
      channelId,
      channelName,
      threadTs,
      parent,
      replies,
      participantUserIds: [parent.user, ...replies.map((r) => r.user)],
      permalink: `https://slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`,
      userDirectory,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: `${channelId}:${threadTs}`,
      kind: 'slack-thread',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}

async function buildUserMap(client: SlackApiClient): Promise<Map<string, UserInfo>> {
  const members = await client.usersList();
  const map = new Map<string, UserInfo>();
  for (const m of members) {
    const isBot = m.is_bot || (m.name ? AUTOMATION_USER_NAMES.has(m.name) : false);
    map.set(m.id, { realName: m.real_name ?? m.id, isBot });
  }
  return map;
}

function isBot(msg: SlackMessage, userMap: Map<string, UserInfo>): boolean {
  if (msg.bot_id) return true;
  if (msg.user && userMap.get(msg.user)?.isBot) return true;
  return false;
}
