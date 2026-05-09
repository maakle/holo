/**
 * Google Chat space → thread chunks projection.
 *
 * Iterates allowed spaces, walks `spaces/{space}/messages` pages ordered by
 * createTime asc, groups messages by their parent thread, fetches the full
 * thread set when a parent has replies, runs the result through the
 * googleChatThreadChunker, and emits chunks via ctx.upsert. Per-space
 * createTime watermarks live on the resource cursor so resumed syncs pick
 * up where they left off.
 */
import { googleChatThreadChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import { listMessagesPage, listThreadMessages } from './api';
import type { GoogleChatMessage, GoogleChatSpace } from './types';

export interface ThreadsCursor {
  /** Per-space watermark: highest `createTime` (RFC 3339) ingested so far. */
  createdAfterPerSpace: Record<string, string>;
}

interface UserInfo {
  displayName: string;
  isBot: boolean;
}

export async function processSpaces(input: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  spaces: ReadonlyArray<GoogleChatSpace>;
}): Promise<ThreadsCursor> {
  const { ctx, spaces } = input;
  const createdAfterPerSpace: Record<string, string> = {
    ...(ctx.cursor.createdAfterPerSpace ?? {}),
  };
  // User directory is built lazily as we encounter senders — Chat doesn't
  // expose a workspace-wide users.list with the read-only scopes we use.
  const userDirectory = new Map<string, UserInfo>();

  for (let i = 0; i < spaces.length; i += 1) {
    ctx.signal?.throwIfAborted();
    const space = spaces[i]!;
    ctx.reportProgress?.({
      current: i + 1,
      total: spaces.length,
      message: `${space.displayName ?? space.name} · scanning…`,
    });

    const oldest = createdAfterPerSpace[space.name];
    const result = await processOneSpace({
      ctx,
      space,
      createdAfter: oldest,
      userDirectory,
    });
    if (result.maxCreateTimeSeen && result.maxCreateTimeSeen !== oldest) {
      createdAfterPerSpace[space.name] = result.maxCreateTimeSeen;
    }

    // Per-space checkpoint so a mid-sync crash resumes at a space boundary.
    await ctx.flushCursor({ createdAfterPerSpace });
  }

  return { createdAfterPerSpace };
}

async function processOneSpace(args: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  space: GoogleChatSpace;
  createdAfter: string | undefined;
  userDirectory: Map<string, UserInfo>;
}): Promise<{ maxCreateTimeSeen: string | undefined }> {
  const { ctx, space, createdAfter, userDirectory } = args;
  let pageToken: string | undefined;
  let maxCreateTimeSeen = createdAfter;
  // Threads we've already emitted in this sweep — Chat returns each reply as
  // its own row in `/messages`, so we dedupe by thread.name to only chunk
  // the thread once.
  const seenThreads = new Set<string>();

  do {
    ctx.signal?.throwIfAborted();
    const page = await listMessagesPage(ctx.api, space.name, {
      pageToken,
      createdAfter,
    });

    for (const msg of page.messages ?? []) {
      ctx.signal?.throwIfAborted();
      rememberSender(userDirectory, msg);
      if (msg.createTime && (!maxCreateTimeSeen || msg.createTime > maxCreateTimeSeen)) {
        maxCreateTimeSeen = msg.createTime;
      }
      if (isBot(msg, userDirectory)) continue;
      const threadName = msg.thread?.name;
      if (!threadName) continue;
      if (seenThreads.has(threadName)) continue;
      seenThreads.add(threadName);

      await emitThread({ ctx, space, threadName, seedMessage: msg, userDirectory });
    }

    pageToken = page.nextPageToken || undefined;
  } while (pageToken);

  return { maxCreateTimeSeen };
}

async function emitThread(args: {
  ctx: ResourceSyncContext<ThreadsCursor>;
  space: GoogleChatSpace;
  threadName: string;
  seedMessage: GoogleChatMessage;
  userDirectory: Map<string, UserInfo>;
}): Promise<void> {
  const { ctx, space, threadName, seedMessage, userDirectory } = args;

  // Fetch the full thread so we don't miss replies that pre-date our cursor
  // window when a thread gets bumped by a new reply. The /messages list with
  // a thread.name filter is the only way to enumerate a thread in v1.
  let messages: GoogleChatMessage[];
  try {
    messages = await listThreadMessages(ctx.api, threadName);
  } catch {
    // Fall back to just the seed message; better to index something than skip
    // the thread entirely on a transient error.
    messages = [seedMessage];
  }
  if (messages.length === 0) messages = [seedMessage];

  for (const m of messages) rememberSender(userDirectory, m);

  const humans = messages.filter((m) => !isBot(m, userDirectory));
  if (humans.length === 0) return;

  const sorted = [...humans].sort(
    (a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime(),
  );
  const parent = sorted[0]!;
  const replies = sorted.slice(1);
  const display = new Map<string, string>();
  for (const [k, v] of userDirectory) display.set(k, v.displayName);

  const sourceArtifactId = `google-chat-thread:${threadName}`;
  const rawChunks = await googleChatThreadChunker.chunk(
    {
      spaceName: space.name,
      spaceDisplayName: space.displayName ?? '',
      threadName,
      parent: {
        senderName: parent.sender?.name ?? '',
        createTime: parent.createTime,
        text: parent.text ?? '',
      },
      replies: replies.map((r) => ({
        senderName: r.sender?.name ?? '',
        createTime: r.createTime,
        text: r.text ?? '',
      })),
      participantUserNames: [
        parent.sender?.name ?? '',
        ...replies.map((r) => r.sender?.name ?? ''),
      ].filter((n) => n.length > 0),
      userDirectory: display,
    },
    {
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      sourceArtifactId,
    },
  );

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: threadName,
      kind: 'google-chat-thread',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
      sourceArtifactId,
    });
  }
}

function rememberSender(
  userDirectory: Map<string, UserInfo>,
  msg: GoogleChatMessage,
): void {
  const sender = msg.sender;
  if (!sender?.name) return;
  if (userDirectory.has(sender.name)) return;
  userDirectory.set(sender.name, {
    displayName: sender.displayName ?? sender.name,
    isBot: sender.type === 'BOT',
  });
}

function isBot(msg: GoogleChatMessage, userDirectory: Map<string, UserInfo>): boolean {
  if (msg.sender?.type === 'BOT') return true;
  const senderName = msg.sender?.name;
  if (!senderName) return false;
  return userDirectory.get(senderName)?.isBot ?? false;
}
