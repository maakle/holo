/**
 * Microsoft Teams read-only sync orchestration.
 *
 * Three concerns layered together:
 *
 *   1. **Resource enumeration** — given a tenant, list every channel-or-chat
 *      the bot is installed in (Graph's RSC permissions enforce the
 *      boundary; we don't filter here).
 *   2. **Delta-cursor state machine** per resource — first run does a
 *      newest-first backfill that promotes itself to a delta watcher
 *      once Graph hands back a `@odata.deltaLink`. Subsequent runs
 *      resume from the deltaLink. Expired delta links (`410 Gone`)
 *      fall back to backfill cleanly.
 *   3. **Thread grouping** — Graph's `/messages` and `/messages/delta`
 *      pages return parents and replies interleaved. The orchestrator
 *      groups them under their `replyToId` chain so the chunker sees
 *      a complete thread (root + sorted replies).
 *
 * This module is intentionally pure-functional: it takes a Graph client
 * and a `ResourceEmitter` callback and never touches the database or
 * BullMQ. The worker queue processor that wires it up to the embed
 * pipeline lives in `apps/worker/src/queues/teams.ts` (step 4b).
 *
 * # Cursor shape
 *
 * One key per resource. The key encodes the resource type so cursors
 * for channels and chats can't collide.
 *
 *   channel-<aadTeamId>:<channelId> → ResourceCursor
 *   chat-<chatId>                   → ResourceCursor
 *
 * A `ResourceCursor` is one of:
 *   - `{ phase: 'backfill', nextLink?: string }`  — initial newest-first paginate
 *   - `{ phase: 'delta', deltaLink: string }`     — resumable incremental
 *   - `{ phase: 'archived', removedAt: string }`  — bot was removed (403),
 *     source row should be archived but chunks retained
 */
import type { TeamsGraphClient } from './graph-api';
import type {
  GraphChannel,
  GraphChat,
  GraphChatMessage,
  GraphCollection,
  GraphConversationMember,
} from './graph-types';

/** Per-resource cursor entry (one value in the org-wide cursor map). */
export type ResourceCursor =
  | { phase: 'backfill'; nextLink?: string }
  | { phase: 'delta'; deltaLink: string }
  | { phase: 'archived'; removedAt: string };

/** Org-wide cursor: resource key → cursor entry. */
export type TeamsCursor = Record<string, ResourceCursor>;

/**
 * The chunker's input shape for one thread. The orchestrator emits one
 * per root-message-id seen in a sync run, with all replies that arrived
 * in the same run grouped under it. The worker layer (step 4b) wires
 * this to the embed pipeline by constructing the matching
 * `TeamsThreadInput` for the chunker.
 */
export interface EmittedThread {
  resourceKind: 'channel' | 'chat';
  resourceCursorKey: string;
  // Channel fields
  teamId?: string;
  teamDisplayName?: string;
  channelId?: string;
  channelDisplayName?: string;
  channelMembershipType?: 'standard' | 'private' | 'shared';
  // Chat fields
  chatId?: string;
  chatTopic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting';
  /** Root message id (Graph stable id). */
  rootMessageId: string;
  /** ISO timestamp on the root message. */
  createdDateTime: string;
  /** Graph's deep-link to the root. Null when Graph didn't supply one. */
  webUrl: string | null;
  parent: GraphChatMessage;
  replies: GraphChatMessage[];
  /** Set of AAD object ids of every human participant in this thread. */
  participantAadObjectIds: string[];
}

/** Notification that an artifact should be deleted (parent message was removed). */
export interface EmittedDeletion {
  resourceKind: 'channel' | 'chat';
  resourceCursorKey: string;
  rootMessageId: string;
}

/**
 * Output emitted per resource. `archived` is set when the bot was
 * removed (Graph 403) — the caller archives the source row but keeps
 * the chunks (already-consented historical content stays retrievable
 * until a separate purge).
 */
export type ResourceEmission =
  | { kind: 'thread'; thread: EmittedThread }
  | { kind: 'deletion'; deletion: EmittedDeletion }
  | { kind: 'archived'; resourceCursorKey: string };

/** Result of one full sync run for one tenant. */
export interface TenantSyncResult {
  tenantId: string;
  resourcesSynced: number;
  threadsEmitted: number;
  deletionsEmitted: number;
  archivedResources: string[];
  /** Resources where the delta link expired and we restarted from backfill. */
  deltaResets: string[];
}

/** Caller-supplied emit callback — runs per-thread and per-deletion. */
export type EmitFn = (emission: ResourceEmission) => Promise<void>;

/** Bumped per-page count to keep memory bounded on busy channels. */
const MAX_MESSAGES_PER_RESOURCE_PER_RUN = 5_000;

/**
 * Sync one tenant. Iterates every team×channel + every chat the bot is
 * installed in, walks the delta or backfill cursor for each, groups
 * threads, and invokes `emit` for each.
 *
 * Returns the updated cursor map — callers persist it to
 * `connector_cursors.metadata`.
 *
 * Errors:
 *  - 403 from any channel/chat call → mark that resource archived (the
 *    bot was removed); continue with the rest.
 *  - 410 Gone on a stored delta link → reset that resource to backfill;
 *    continue.
 *  - 429 / 5xx handled in the Graph client (Retry-After + budget).
 *  - Any other error bubbles up.
 */
export async function runTenantSync(args: {
  graph: TeamsGraphClient;
  tenantId: string;
  /** Cursor read from connector_cursors at job start. Empty object on first run. */
  cursorIn: TeamsCursor;
  emit: EmitFn;
  /** Throttle for huge tenants — break out of this sync run after N threads. */
  maxThreads?: number;
}): Promise<{ cursor: TeamsCursor; result: TenantSyncResult }> {
  const cursor: TeamsCursor = { ...args.cursorIn };
  const result: TenantSyncResult = {
    tenantId: args.tenantId,
    resourcesSynced: 0,
    threadsEmitted: 0,
    deletionsEmitted: 0,
    archivedResources: [],
    deltaResets: [],
  };

  const teams = await args.graph.listJoinedTeams();
  for (const team of teams) {
    let channels: GraphChannel[];
    try {
      channels = await args.graph.listTeamChannels(team.id);
    } catch (err) {
      if (isGraphForbidden(err)) {
        // Bot removed at the team level (rare) — every channel in this
        // team becomes inaccessible. We don't know channel ids ahead of
        // time; rely on each individual channel call to 403 below if
        // it tries.
        continue;
      }
      throw err;
    }
    for (const channel of channels) {
      if (channel.membershipType === 'shared') {
        // Cross-tenant shared channels have a different ACL story;
        // explicit out-of-scope per the design doc.
        continue;
      }
      const cursorKey = channelCursorKey(team.id, channel.id);
      const before = result.threadsEmitted;
      const after = await syncOneResource({
        graph: args.graph,
        cursorKey,
        cursorEntry: cursor[cursorKey],
        emit: args.emit,
        result,
        loader: makeChannelLoader(args.graph, team.id, channel.id),
        emissionContext: {
          resourceKind: 'channel',
          resourceCursorKey: cursorKey,
          teamId: team.id,
          teamDisplayName: team.displayName,
          channelId: channel.id,
          channelDisplayName: channel.displayName,
          channelMembershipType: channel.membershipType,
        },
      });
      cursor[cursorKey] = after;
      result.resourcesSynced += 1;
      if (args.maxThreads && result.threadsEmitted >= args.maxThreads) {
        // Caller-imposed per-run cap — leave the rest for the next
        // scheduled run.
        void before;
        return { cursor, result };
      }
    }
  }

  let chatsPage: GraphCollection<GraphChat> | undefined =
    await args.graph.listChats();
  while (chatsPage) {
    for (const chat of chatsPage.value) {
      if (chat.chatType === 'oneOnOne') {
        // The bot's own DMs with users; never useful corpus content.
        continue;
      }
      const cursorKey = chatCursorKey(chat.id);
      const after = await syncOneResource({
        graph: args.graph,
        cursorKey,
        cursorEntry: cursor[cursorKey],
        emit: args.emit,
        result,
        loader: makeChatLoader(args.graph, chat.id),
        emissionContext: {
          resourceKind: 'chat',
          resourceCursorKey: cursorKey,
          chatId: chat.id,
          chatTopic: chat.topic ?? null,
          chatType: chat.chatType,
        },
      });
      cursor[cursorKey] = after;
      result.resourcesSynced += 1;
      if (args.maxThreads && result.threadsEmitted >= args.maxThreads) {
        return { cursor, result };
      }
    }
    chatsPage =
      chatsPage['@odata.nextLink'] !== undefined
        ? await args.graph.fetchUrl<GraphCollection<GraphChat>>(
            chatsPage['@odata.nextLink'],
          )
        : undefined;
  }

  return { cursor, result };
}

/**
 * Per-resource pluggable loader so the same state machine handles both
 * channel and chat message endpoints. Each loader knows which Graph
 * method to call for initial-backfill, delta-init, and arbitrary URL
 * resume.
 */
interface ResourceLoader {
  backfillFirst(): Promise<GraphCollection<GraphChatMessage>>;
  deltaInit(): Promise<GraphCollection<GraphChatMessage>>;
}

function makeChannelLoader(
  graph: TeamsGraphClient,
  teamId: string,
  channelId: string,
): ResourceLoader {
  return {
    backfillFirst: () => graph.listChannelMessages(teamId, channelId),
    deltaInit: () => graph.channelMessagesDeltaInit(teamId, channelId),
  };
}

function makeChatLoader(graph: TeamsGraphClient, chatId: string): ResourceLoader {
  return {
    backfillFirst: () => graph.listChatMessages(chatId),
    deltaInit: () => graph.chatMessagesDeltaInit(chatId),
  };
}

/** Common fields the emitter needs per resource. */
interface EmissionContext {
  resourceKind: 'channel' | 'chat';
  resourceCursorKey: string;
  teamId?: string;
  teamDisplayName?: string;
  channelId?: string;
  channelDisplayName?: string;
  channelMembershipType?: 'standard' | 'private' | 'shared';
  chatId?: string;
  chatTopic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting';
}

/**
 * Drive one resource through one sync run. Reads the prior cursor,
 * decides backfill-vs-delta, walks pages until exhausted or a deltaLink
 * appears, emits threads + deletions along the way. Returns the new
 * cursor entry to persist.
 */
async function syncOneResource(args: {
  graph: TeamsGraphClient;
  cursorKey: string;
  cursorEntry: ResourceCursor | undefined;
  emit: EmitFn;
  result: TenantSyncResult;
  loader: ResourceLoader;
  emissionContext: EmissionContext;
}): Promise<ResourceCursor> {
  const prior = args.cursorEntry;
  if (prior?.phase === 'archived') {
    // Already archived; nothing to do until an operator unarchives.
    return prior;
  }

  let url: string | undefined;
  let page: GraphCollection<GraphChatMessage>;
  try {
    if (prior?.phase === 'delta') {
      url = prior.deltaLink;
      page = await args.graph.fetchUrl<GraphCollection<GraphChatMessage>>(url);
    } else if (prior?.phase === 'backfill' && prior.nextLink) {
      url = prior.nextLink;
      page = await args.graph.fetchUrl<GraphCollection<GraphChatMessage>>(url);
    } else {
      // First time we've seen this resource — prefer delta-init over
      // raw backfill so Graph hands back a resumable token from page 1.
      page = await args.loader.deltaInit();
    }
  } catch (err) {
    if (isGraphForbidden(err)) {
      const removedAt = new Date().toISOString();
      args.result.archivedResources.push(args.cursorKey);
      await args.emit({ kind: 'archived', resourceCursorKey: args.cursorKey });
      return { phase: 'archived', removedAt };
    }
    if (isGraphGone(err)) {
      // Delta link expired (Graph drops them after ~30 days of non-use).
      // Reset to a fresh backfill on the next run.
      args.result.deltaResets.push(args.cursorKey);
      return { phase: 'backfill' };
    }
    throw err;
  }

  const seen = new Map<string, GraphChatMessage>();
  let messageCount = 0;

  while (true) {
    for (const m of page.value ?? []) {
      // Defensive: Graph occasionally returns null body on deleted-via-
      // delta entries; surface them as deletions.
      if (m['@removed']?.reason === 'deleted' || m.deletedDateTime) {
        await args.emit({
          kind: 'deletion',
          deletion: {
            resourceKind: args.emissionContext.resourceKind,
            resourceCursorKey: args.cursorKey,
            // For a deletion entry the id is the message that was
            // deleted; the root may have been deleted OR a reply.
            // Caller decides whether to drop the whole thread or one
            // chunk; we surface the id and let downstream decide.
            rootMessageId: m.id,
          },
        });
        args.result.deletionsEmitted += 1;
        continue;
      }
      if (
        m.messageType === 'systemEventMessage' ||
        m.messageType === 'unknownFutureValue'
      ) {
        // System events: "user joined channel", "topic changed" — not
        // substantive content, skip at the orchestrator so the chunker
        // never sees them.
        continue;
      }
      seen.set(m.id, m);
      messageCount += 1;
      if (messageCount > MAX_MESSAGES_PER_RESOURCE_PER_RUN) {
        // Defensive cap — extremely large channels could otherwise
        // unbounded the heap. Stop paging; the next run resumes from
        // the prior nextLink/deltaLink (whichever Graph last gave us).
        break;
      }
    }

    if (messageCount > MAX_MESSAGES_PER_RESOURCE_PER_RUN) break;

    const next = page['@odata.nextLink'];
    if (!next) break;
    page = await args.graph.fetchUrl<GraphCollection<GraphChatMessage>>(next);
  }

  // Group messages into threads (root + replies).
  const threads = groupThreads([...seen.values()]);
  for (const thread of threads) {
    await args.emit({
      kind: 'thread',
      thread: {
        ...args.emissionContext,
        rootMessageId: thread.root.id,
        createdDateTime: thread.root.createdDateTime,
        webUrl: thread.root.webUrl ?? null,
        parent: thread.root,
        replies: thread.replies,
        participantAadObjectIds: distinctParticipants(thread),
      },
    });
    args.result.threadsEmitted += 1;
  }

  // Decide the next cursor.
  const deltaLink = page['@odata.deltaLink'];
  if (deltaLink) {
    return { phase: 'delta', deltaLink };
  }
  const nextLink = page['@odata.nextLink'];
  if (nextLink) {
    // We capped at MAX_MESSAGES; persist the nextLink so the next run
    // continues the backfill where this one stopped.
    return { phase: 'backfill', nextLink };
  }
  // No deltaLink and no nextLink — Graph reached the end of available
  // history during a non-delta walk. This is rare for messages-list
  // (deltaInit() should produce a deltaLink eventually), but if it
  // happens, prompt the next run to re-init delta from scratch.
  return { phase: 'backfill' };
}

/**
 * Group a flat list of messages into thread bundles (root + replies),
 * sorted by `replyToId`. Exported for unit tests.
 *
 * Edge cases:
 *  - A reply whose root isn't in the same page is held back — the
 *    caller's next sync run will return the same root (delta replays)
 *    OR the reply, but until they're co-located in one page we can't
 *    emit a complete thread. Skip with a debug log.
 *  - Two roots with the same id (impossible per Graph contract, but
 *    defensive) are deduped by id; first wins.
 */
export interface GroupedThread {
  root: GraphChatMessage;
  replies: GraphChatMessage[];
}

export function groupThreads(messages: GraphChatMessage[]): GroupedThread[] {
  const roots = new Map<string, GraphChatMessage>();
  const repliesByParent = new Map<string, GraphChatMessage[]>();
  for (const m of messages) {
    if (m.replyToId) {
      const arr = repliesByParent.get(m.replyToId) ?? [];
      arr.push(m);
      repliesByParent.set(m.replyToId, arr);
    } else if (!roots.has(m.id)) {
      roots.set(m.id, m);
    }
  }
  const out: GroupedThread[] = [];
  for (const [id, root] of roots) {
    const replies = (repliesByParent.get(id) ?? []).slice().sort(
      (a, b) =>
        new Date(a.createdDateTime).getTime() -
        new Date(b.createdDateTime).getTime(),
    );
    out.push({ root, replies });
  }
  return out;
}

function distinctParticipants(thread: GroupedThread): string[] {
  const set = new Set<string>();
  const tryAdd = (m: GraphChatMessage): void => {
    const uid = m.from?.user?.id;
    if (uid) set.add(uid);
  };
  tryAdd(thread.root);
  for (const r of thread.replies) tryAdd(r);
  return [...set];
}

function channelCursorKey(teamId: string, channelId: string): string {
  return `channel-${teamId}:${channelId}`;
}

function chatCursorKey(chatId: string): string {
  return `chat-${chatId}`;
}

function isGraphForbidden(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const problem = (err as { problem?: unknown }).problem;
  return typeof problem === 'string' && problem.includes(' 403 ');
}

function isGraphGone(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const problem = (err as { problem?: unknown }).problem;
  return typeof problem === 'string' && problem.includes(' 410 ');
}

/**
 * Convenience helper: load membership rosters for ACL derivation.
 * Returns AAD object ids of every member of the given resource. The
 * worker layer calls this once per resource (cached in
 * `sources.metadata.member_aad_ids`) and uses it to populate the
 * `team_subjects` / `chat_subjects` rows that the chunker's ACL
 * subjects join against.
 *
 * Exported here (rather than in graph-api.ts) because the
 * post-processing — normalizing `userId` across team/chat member
 * shapes — is the orchestrator's concern, not the HTTP client's.
 */
export async function loadResourceMembers(
  graph: TeamsGraphClient,
  resource:
    | { kind: 'channel'; teamId: string }
    | { kind: 'chat'; chatId: string },
): Promise<string[]> {
  let members: GraphConversationMember[];
  if (resource.kind === 'channel') {
    members = await graph.listTeamMembers(resource.teamId);
  } else {
    members = await graph.listChatMembers(resource.chatId);
  }
  const out = new Set<string>();
  for (const m of members) {
    if (m.userId) out.add(m.userId);
  }
  return [...out];
}

/**
 * Defensive shape-asserter for stored cursor JSON. The cursor lives in
 * `connector_cursors.metadata` as untyped JSONB; this validates that
 * each entry has a known `phase` before the state machine trusts it.
 * Unknown shapes are dropped (treated as first-run).
 */
export function parseStoredCursor(raw: unknown): TeamsCursor {
  if (!raw || typeof raw !== 'object') return {};
  const out: TeamsCursor = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const phase = (v as { phase?: unknown }).phase;
    if (phase === 'backfill') {
      const nextLink = (v as { nextLink?: unknown }).nextLink;
      out[k] =
        typeof nextLink === 'string'
          ? { phase: 'backfill', nextLink }
          : { phase: 'backfill' };
    } else if (phase === 'delta') {
      const deltaLink = (v as { deltaLink?: unknown }).deltaLink;
      if (typeof deltaLink === 'string') out[k] = { phase: 'delta', deltaLink };
    } else if (phase === 'archived') {
      const removedAt = (v as { removedAt?: unknown }).removedAt;
      out[k] = {
        phase: 'archived',
        removedAt: typeof removedAt === 'string' ? removedAt : new Date().toISOString(),
      };
    }
    // Unknown phase: drop, restart from first-run.
  }
  return out;
}

// Surface helpers exported for tests.
export const __testing = {
  channelCursorKey,
  chatCursorKey,
  isGraphForbidden,
  isGraphGone,
};

