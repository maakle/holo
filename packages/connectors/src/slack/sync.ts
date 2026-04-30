import { slackThreadChunker } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import { ErrorCode, holoError } from '@holo/errors';
import type { SlackApiClient, SlackMessage } from './api-client';

const AUTOMATION_USER_NAMES = new Set(['github', 'pagerduty', 'circleci', 'linear', 'dependabot']);
const BATCH_SIZE = 50;

export type ChunkPayload = {
  kind: 'slack-thread';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'slack';
  sourceId: string;
  organizationId: string;
};

export type EmbedEnqueueFn = (payload: {
  channelId: string;
  chunks: ChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface RunSlackSyncInput {
  client: SlackApiClient;
  allowedChannelIds: string[];
  cursorMetadata: Record<string, unknown>;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: EmbedEnqueueFn;
  logger?: { warn(obj: unknown): void };
}

export interface RunSlackSyncOutput {
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}

export async function runSlackSync(input: RunSlackSyncInput): Promise<RunSlackSyncOutput> {
  if (input.allowedChannelIds.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
      problem: 'Slack sync has no allowlisted channels',
      fix: 'Add at least one channel ID to the Slack allowlist.',
    });
  }

  const logger = input.logger ?? { warn: () => {} };
  const oldestPerChannel: Record<string, string> = {
    ...((input.cursorMetadata['oldest_per_channel'] as Record<string, string>) ?? {}),
  };
  const botNotInChannel: string[] = [
    ...((input.cursorMetadata['bot_not_in_channel'] as string[]) ?? []),
  ];

  const userMap = await buildUserMap(input.client);
  let totalArtifacts = 0;

  for (const channelId of input.allowedChannelIds) {
    const channel = await input.client.conversationsInfo(channelId);
    if (!channel) continue;

    const oldest = oldestPerChannel[channelId] ?? '0';
    const chunksForChannel: ChunkPayload[] = [];
    let maxTsSeen = oldest;

    let nextCursor: string | undefined;
    let bailed = false;

    do {
      let page: Awaited<ReturnType<SlackApiClient['conversationsHistory']>>;
      try {
        page = await input.client.conversationsHistory(channelId, { oldest, cursor: nextCursor });
      } catch (err) {
        const code = (err as { data?: { error?: string } }).data?.error;
        if (code === 'not_in_channel') {
          if (!botNotInChannel.includes(channelId)) botNotInChannel.push(channelId);
          logger.warn({
            code: 'HOLO_SLACK_BOT_NOT_INVITED',
            channelId,
            channelName: channel.name,
            message: `Skipping ${channel.name}: run /invite @holo in Slack and re-run sync.`,
          });
          bailed = true;
          break;
        }
        throw err;
      }

      for (const msg of page.messages) {
        if (isBot(msg, userMap)) continue;
        const ts = msg.ts;
        if (ts > maxTsSeen) maxTsSeen = ts;

        // Only process thread parents (msg.thread_ts absent = standalone, or thread_ts === ts = parent)
        const isParent = !msg.thread_ts || msg.thread_ts === ts;
        if (!isParent) continue;

        const threadTs = ts;
        let parent: { user: string; ts: string; text: string };
        let replies: Array<{ user: string; ts: string; text: string }> = [];

        if (msg.reply_count && msg.reply_count > 0) {
          const all = (await input.client.conversationsReplies(channelId, threadTs))
            .filter((m) => !isBot(m, userMap))
            .map((m) => ({ user: m.user ?? '', ts: m.ts, text: m.text ?? '' }));
          parent = all[0] ?? { user: msg.user ?? '', ts, text: msg.text ?? '' };
          replies = all.slice(1);
        } else {
          parent = { user: msg.user ?? '', ts, text: msg.text ?? '' };
        }

        const sourceArtifactId = `slack-thread:${channelId}:${threadTs}`;
        const userDirectory = new Map(
          [...userMap.entries()].map(([id, info]) => [id, info.realName]),
        );
        const chunks = await slackThreadChunker.chunk(
          {
            channelId,
            channelName: channel.name,
            threadTs,
            parent,
            replies,
            participantUserIds: [parent.user, ...replies.map((r) => r.user)],
            permalink: `https://slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`,
            userDirectory,
          },
          {
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            sourceArtifactId,
          },
        );

        for (const c of chunks) {
          const hash = chunkHash('slack-thread', c.content);
          if (input.existingHashes.has(hash)) continue;
          chunksForChannel.push({
            kind: 'slack-thread',
            content: c.content,
            metadata: c.metadata,
            aclSubjects: c.aclSubjects,
            contentHash: hash,
            sourceArtifactId,
            provider: 'slack',
            sourceId: input.sourceId,
            organizationId: input.organizationId,
          });
        }
      }
      nextCursor = page.nextCursor;
    } while (nextCursor && !bailed);

    if (!bailed && chunksForChannel.length > 0) {
      for (let i = 0; i < chunksForChannel.length; i += BATCH_SIZE) {
        await input.enqueueEmbed({
          channelId,
          chunks: chunksForChannel.slice(i, i + BATCH_SIZE),
          organizationId: input.organizationId,
          sourceId: input.sourceId,
        });
      }
      totalArtifacts += chunksForChannel.length;
    }

    if (!bailed && maxTsSeen !== oldest) {
      // Advance cursor by 1µs so the next incremental excludes this timestamp
      oldestPerChannel[channelId] = (parseFloat(maxTsSeen) + 0.000001).toFixed(6);
    }
  }

  const updatedMetadata: Record<string, unknown> = {
    ...input.cursorMetadata,
    oldest_per_channel: oldestPerChannel,
    bot_not_in_channel: botNotInChannel,
  };

  return { artifactCount: totalArtifacts, updatedMetadata };
}

type UserInfo = { realName: string; isBot: boolean };

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
