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
  /**
   * Persist partial cursor metadata after each channel completes. Lets a
   * mid-sync failure (rate limit exhaustion, network blip) resume from the
   * last fully-synced channel instead of starting over. Optional — when
   * absent, runSlackSync returns metadata only at the end (legacy behavior).
   */
  flushCursor?: (metadata: Record<string, unknown>) => Promise<void>;
  logger?: { warn(obj: unknown): void; info?(obj: unknown): void };
  /**
   * Cooperative cancellation. Checked between channels and between pages so
   * "Stop sync" exits within seconds instead of running to completion. Already-
   * fetched chunks for the current channel are not enqueued once aborted, and
   * the partial cursor is flushed for the channels we did finish.
   */
  signal?: AbortSignal;
  reportProgress?: (input: {
    current: number;
    total?: number | null;
    message?: string;
  }) => void;
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

  const logger = {
    warn: input.logger?.warn ?? (() => {}),
    info: input.logger?.info ?? ((obj: unknown) => {
      // Default to stdout so progress shows up in `pnpm dev` worker logs
      // even when no NestJS logger is plumbed through.
      const msg = typeof obj === 'string' ? obj : JSON.stringify(obj);
      process.stdout.write(`[slack-sync] ${msg}\n`);
    }),
  };
  const oldestPerChannel: Record<string, string> = {
    ...((input.cursorMetadata['oldest_per_channel'] as Record<string, string>) ?? {}),
  };
  const botNotInChannel: string[] = [
    ...((input.cursorMetadata['bot_not_in_channel'] as string[]) ?? []),
  ];

  const totalChannels = input.allowedChannelIds.length;
  input.reportProgress?.({
    current: 0,
    total: totalChannels,
    message: 'Loading workspace users…',
  });
  const userMap = await buildUserMap(input.client);
  let totalArtifacts = 0;

  for (let channelIdx = 0; channelIdx < input.allowedChannelIds.length; channelIdx += 1) {
    const channelId = input.allowedChannelIds[channelIdx]!;
    input.signal?.throwIfAborted();
    const channel = await input.client.conversationsInfo(channelId);
    if (!channel) continue;
    input.reportProgress?.({
      current: channelIdx + 1,
      total: totalChannels,
      message: `#${channel.name} · scanning…`,
    });
    logger.info(`channel ${channelIdx + 1}/${totalChannels}: #${channel.name} starting`);

    const oldest = oldestPerChannel[channelId] ?? '0';
    let maxTsSeen = oldest;

    let nextCursor: string | undefined;
    let bailed = false;
    let pageNum = 0;
    let threadsScanned = 0;
    let chunksThisChannel = 0;
    let pendingChunks: ChunkPayload[] = [];

    const flushPending = async (): Promise<void> => {
      if (pendingChunks.length === 0) return;
      const batch = pendingChunks;
      pendingChunks = [];
      await input.enqueueEmbed({
        channelId,
        chunks: batch,
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
    };

    do {
      input.signal?.throwIfAborted();
      pageNum += 1;
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

      const parentsThisPage = page.messages.filter((m) => {
        if (isBot(m, userMap)) return false;
        return !m.thread_ts || m.thread_ts === m.ts;
      });
      logger.info(
        `#${channel.name} page ${pageNum}: ${page.messages.length} msgs, ${parentsThisPage.length} thread parents`,
      );

      let parentIdx = 0;
      for (const msg of page.messages) {
        if (isBot(msg, userMap)) continue;
        const ts = msg.ts;
        if (ts > maxTsSeen) maxTsSeen = ts;

        // Only process thread parents (msg.thread_ts absent = standalone, or thread_ts === ts = parent)
        const isParent = !msg.thread_ts || msg.thread_ts === ts;
        if (!isParent) continue;
        parentIdx += 1;
        threadsScanned += 1;

        // Heartbeat per-thread so the UI ticks while we're paced waiting on
        // conversations.replies (1.5s each). The worker debounces these to
        // ~1/sec so calling on every iteration is safe.
        input.reportProgress?.({
          current: channelIdx + 1,
          total: totalChannels,
          message: `#${channel.name} · page ${pageNum} · thread ${parentIdx}/${parentsThisPage.length} · ${chunksThisChannel} chunks`,
        });

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
          pendingChunks.push({
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
          chunksThisChannel += 1;
          totalArtifacts += 1;

          // Stream complete batches to the embed queue as we go so the UI's
          // live chunk count ticks up during a long sync, instead of dumping
          // everything at the end of the channel.
          if (pendingChunks.length >= BATCH_SIZE) {
            await flushPending();
          }
        }
      }
      nextCursor = page.nextCursor;
    } while (nextCursor && !bailed);

    if (!bailed) {
      await flushPending();
      logger.info(
        `#${channel.name} done: ${threadsScanned} threads scanned, ${chunksThisChannel} new chunks queued`,
      );
    }

    if (!bailed && maxTsSeen !== oldest) {
      // Advance cursor by 1µs so the next incremental excludes this timestamp
      oldestPerChannel[channelId] = (parseFloat(maxTsSeen) + 0.000001).toFixed(6);
    }

    // Flush partial progress after each channel so a later failure doesn't
    // discard everything. Best-effort — a flush failure shouldn't abort the
    // sync (we'll persist again on the next channel or at the end).
    if (input.flushCursor) {
      try {
        await input.flushCursor({
          ...input.cursorMetadata,
          oldest_per_channel: oldestPerChannel,
          bot_not_in_channel: botNotInChannel,
        });
      } catch (err) {
        logger.warn({
          code: 'HOLO_SLACK_CURSOR_FLUSH_FAILED',
          channelId,
          error: (err as Error).message,
        });
      }
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
