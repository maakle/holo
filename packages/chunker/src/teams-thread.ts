import type { Chunker, Chunk, ChunkContext } from './contract';

/**
 * One Microsoft Teams thread (a root message + its replies), ready for
 * chunking. Produced by the sync runner in
 * `packages/connectors/src/teams/sync.ts` after grouping replies under
 * their `replyToId` parent.
 *
 * Two flavours, distinguished by `resourceKind`:
 *
 *   - channel post  → ACL is `team:<aadTeamId>`; path lives under
 *                     `/teams/<team>/<channel>/<YYYY-MM-DD>/<root>.md`.
 *                     Private channels override the ACL to
 *                     `team-channel:<channelId>` so members of the
 *                     parent team who aren't in the private channel
 *                     don't see the content via retrieval.
 *   - chat thread   → ACL is `chat:<chatId>`; path lives under
 *                     `/teams/chats/<label>/<root>.md`.
 *
 * `webUrl` is Graph's deep-link to the root message; we stamp it onto
 * the chunk metadata so `urlFns['teams-thread']` resolves it without
 * a Graph round-trip.
 */
export interface TeamsThreadInput {
  /** AAD object id (channel) OR chat id, used in the chunk ACL subject. */
  resourceKind: 'channel' | 'chat';

  // Channel-flavoured fields (set when resourceKind === 'channel')
  teamId?: string;
  teamDisplayName?: string;
  channelId?: string;
  channelDisplayName?: string;
  /**
   * `standard` | `private` | `shared`. `private` overrides the ACL to be
   * channel-scoped rather than team-scoped. `shared` (cross-tenant) is
   * skipped by the sync runner — won't reach here in practice.
   */
  channelMembershipType?: 'standard' | 'private' | 'shared';

  // Chat-flavoured fields (set when resourceKind === 'chat')
  chatId?: string;
  chatTopic?: string | null;
  /** `oneOnOne` | `group` | `meeting`. */
  chatType?: 'oneOnOne' | 'group' | 'meeting';

  /** Stable Graph message id of the thread root. */
  rootMessageId: string;
  /** ISO timestamp of the root message — used for the path date segment. */
  createdDateTime: string;
  /** Optional deep-link Graph supplied for the root message. */
  webUrl?: string | null;

  /** The root message + its replies (already sorted oldest-first by the runner). */
  parent: TeamsMessageInput;
  replies: TeamsMessageInput[];

  /** AAD object ids of every human participant; for participants metadata. */
  participantAadObjectIds: string[];
  /** display name keyed by AAD object id. */
  userDirectory: Map<string, string>;
}

export interface TeamsMessageInput {
  /** Graph message id. */
  id: string;
  /** ISO timestamp. */
  createdDateTime: string;
  /** AAD object id of the human author. Absent for messages authored by an `application`. */
  fromUserId?: string;
  /** Display name resolved at sync time; falls back to AAD oid in the chunker. */
  fromDisplayName?: string;
  /** `text` or `html` per Graph's `body.contentType`. */
  bodyContentType: 'text' | 'html';
  /** Raw body content. The chunker strips HTML at format time. */
  bodyContent: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Strip HTML tags + collapse whitespace. Teams' `body.contentType: 'html'`
 * arrives from Outlook actionable messages, Power Automate flows, and
 * any rich client that renders inline tables / cards. We don't bring in
 * a full HTML→markdown converter here because (a) the LLM tolerates raw
 * text fine, and (b) the markdown surface area for Teams cards is
 * larger than the win from rendering it precisely.
 *
 * Defenses:
 *  - `<script>`, `<style>` blocks dropped entirely (Graph shouldn't
 *    return them but we don't want to surface attacker-controlled
 *    payload to the LLM as quasi-instructions).
 *  - `&entity;` decoded for the common five.
 *  - Trailing/leading whitespace trimmed; runs of internal whitespace
 *    collapsed to a single space.
 */
export function stripHtmlBody(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    // Both opening and closing block tags introduce breaks so that
    // `text<p>more</p>tail` reads as three lines, not two.
    .replace(/<(p|div|li|tr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatMessage(
  msg: TeamsMessageInput,
  userDirectory: Map<string, string>,
): string {
  const display =
    msg.fromDisplayName ??
    (msg.fromUserId ? (userDirectory.get(msg.fromUserId) ?? msg.fromUserId) : 'app');
  const body =
    msg.bodyContentType === 'html'
      ? stripHtmlBody(msg.bodyContent)
      : msg.bodyContent.trim();
  return `@${display} [${formatTime(msg.createdDateTime)}]: ${body}\n`;
}

/**
 * ACL subjects derived from the resource the thread lives in:
 *
 *  - channel posts → `team:<aadTeamId>` (every team member can read)
 *  - PRIVATE channel posts → `team-channel:<channelId>` (only channel
 *    members; team-wide subject would leak to non-channel members)
 *  - chat threads → `chat:<chatId>` (only chat participants)
 *
 * Always prefixed with `org:<organizationId>` so retrieval can never
 * cross orgs even if a user-subject derivation has a bug.
 */
function deriveAclSubjects(input: TeamsThreadInput, organizationId: string): string[] {
  const subjects = [`org:${organizationId}`];
  if (input.resourceKind === 'channel') {
    if (input.channelMembershipType === 'private' && input.channelId) {
      subjects.push(`team-channel:${input.channelId}`);
    } else if (input.teamId) {
      subjects.push(`team:${input.teamId}`);
    }
  } else if (input.chatId) {
    subjects.push(`chat:${input.chatId}`);
  }
  return subjects;
}

export const teamsThreadChunker: Chunker<TeamsThreadInput> = {
  kind: 'teams-thread',
  embeddingModel: 'openai-3-small',
  async chunk(input: TeamsThreadInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId =
      input.resourceKind === 'channel'
        ? `teams-thread:${input.teamId}/${input.channelId}/${input.rootMessageId}`
        : `teams-thread:${input.chatId}/${input.rootMessageId}`;

    const aclSubjects = deriveAclSubjects(input, ctx.organizationId);

    // Replies arrive in random order from `/messages/delta`; sort here
    // so the formatted thread reads top-to-bottom.
    const sortedReplies = [...input.replies].sort(
      (a, b) =>
        new Date(a.createdDateTime).getTime() - new Date(b.createdDateTime).getTime(),
    );

    const lines = [formatMessage(input.parent, input.userDirectory)];
    for (const reply of sortedReplies) {
      lines.push(formatMessage(reply, input.userDirectory));
    }

    const metadata: Record<string, unknown> = {
      resource_kind: input.resourceKind,
      root_message_id: input.rootMessageId,
      created_date_time: input.createdDateTime,
      participant_aad_object_ids: input.participantAadObjectIds,
    };
    if (input.webUrl) metadata['web_url'] = input.webUrl;
    if (input.resourceKind === 'channel') {
      metadata['team_id'] = input.teamId;
      metadata['team_display_name'] = input.teamDisplayName;
      metadata['channel_id'] = input.channelId;
      metadata['channel_display_name'] = input.channelDisplayName;
      metadata['channel_membership_type'] = input.channelMembershipType;
    } else {
      metadata['chat_id'] = input.chatId;
      metadata['chat_topic'] = input.chatTopic ?? null;
      metadata['chat_type'] = input.chatType;
    }

    return [
      {
        content: lines.join(''),
        parentExternalId,
        metadata,
        aclSubjects,
      },
    ];
  },
};
