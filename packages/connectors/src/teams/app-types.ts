/**
 * Microsoft Teams Bot Framework Activity envelope + Adaptive Card v1.4
 * shapes — projected to the fields the inbound handler and outbound
 * message builder actually read.
 *
 * Camel-case keys mirror Bot Framework's wire format; do not rename.
 *
 * Reference: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference
 */

/**
 * Inbound Activity envelope POSTed at /api/messages. Discriminator is
 * `type`; the handler only acts on `message` and `messageReaction`. Other
 * types (`conversationUpdate`, `typing`, `invoke`, …) ack 200 without
 * work.
 */
export interface TeamsActivity {
  type: TeamsActivityType;
  /** Stable id across Microsoft retries — primary dedupe key. */
  id: string;
  /** ISO 8601 timestamp from the Bot Framework. */
  timestamp?: string;
  /**
   * Bot Framework region service URL the bot must POST replies to
   * (e.g. `https://smba.trafficmanager.net/amer/`). Per-request — store
   * the most recently observed value with each conversation. The JWT
   * `serviceurl` claim must match this exactly.
   */
  serviceUrl: string;
  /** Channel name (always `'msteams'` for our purposes). */
  channelId?: string;
  conversation: TeamsConversation;
  from?: TeamsChannelAccount;
  /** The bot itself. Activities the bot sent will not be re-delivered, but `recipient.id === bot.id` always. */
  recipient?: TeamsChannelAccount;
  /** Visible message body. For mentions, includes `<at>bot</at>` spans the handler must strip. */
  text?: string;
  /**
   * Mention entities and other rich content. The handler iterates
   * `entities[].type === 'mention'` to detect bot mentions even when
   * `<at>` tags are mangled.
   */
  entities?: TeamsEntity[];
  /** For channel/groupChat activities, `channelData.tenant.id` carries the AAD tenant. */
  channelData?: TeamsChannelData;
  /** For `messageReaction`, points at the bot reply receiving the reaction. */
  replyToId?: string;
  /** For `messageReaction`, the added reactions. */
  reactionsAdded?: TeamsMessageReaction[];
  /** For `messageReaction`, the removed reactions. */
  reactionsRemoved?: TeamsMessageReaction[];
}

export type TeamsActivityType =
  | 'message'
  | 'messageReaction'
  | 'conversationUpdate'
  | 'invoke'
  | 'typing'
  | 'event';

export interface TeamsConversation {
  /**
   * For channel posts, this id encodes the thread:
   * `19:xxx@thread.tacv2;messageid=yyy`. Posting to the same id keeps
   * replies in-thread automatically.
   */
  id: string;
  /** `personal` = 1:1 DM, `channel` = team channel, `groupChat` = ad-hoc group. */
  conversationType?: 'personal' | 'channel' | 'groupChat';
  /** Display name (Teams populates for channels/groupChats). */
  name?: string;
  isGroup?: boolean;
  tenantId?: string;
}

export interface TeamsChannelAccount {
  /** Service id — opaque per channel. */
  id: string;
  name?: string;
  /** Azure AD object id of the user. Preferred stable identifier across renames. */
  aadObjectId?: string;
}

export interface TeamsEntity {
  type: string;
  /** For `type === 'mention'`. */
  mentioned?: TeamsChannelAccount;
  /** Rendered mention text (`<at>holo</at>`). */
  text?: string;
}

export interface TeamsChannelData {
  /** AAD tenant carrying the asker. */
  tenant?: { id?: string };
  /** Microsoft Team-level id (for `channel` conversations). */
  team?: { id?: string };
  /** Channel id within the team. */
  channel?: { id?: string };
}

export interface TeamsMessageReaction {
  /** Built-in: `like` | `heart` | `laugh` | `surprised` | `sad` | `angry`. Custom reactions deliver as opaque strings. */
  type: string;
}

/**
 * Adaptive Card v1.4 body. We use a narrow subset — TextBlock + Container
 * + ActionSet/OpenUrl. Stay on 1.4 for broad client compatibility (older
 * Teams desktop builds plateau there). Compound widgets and 1.5
 * affordances layer on later behind the same export shape.
 *
 * Reference: https://adaptivecards.io/schemas/1.4.0/
 */
export interface AdaptiveCardV14 {
  type: 'AdaptiveCard';
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  version: '1.4';
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
}

export type AdaptiveCardElement =
  | {
      type: 'TextBlock';
      text: string;
      wrap?: boolean;
      isSubtle?: boolean;
      size?: 'small' | 'default' | 'medium' | 'large' | 'extraLarge';
      weight?: 'lighter' | 'default' | 'bolder';
      spacing?: 'none' | 'small' | 'default' | 'medium' | 'large' | 'extraLarge';
      separator?: boolean;
    }
  | {
      type: 'Container';
      items: AdaptiveCardElement[];
      separator?: boolean;
    };

export type AdaptiveCardAction = {
  type: 'Action.OpenUrl';
  title: string;
  url: string;
};

/**
 * Outbound Activity body sent to
 * `POST {serviceUrl}/v3/conversations/{conversationId}/activities` or
 * the PUT variant. We always send `text` (fallback for notifications +
 * old clients) alongside an Adaptive Card attachment.
 */
export interface TeamsOutboundActivity {
  type: 'message';
  /** Plaintext fallback shown in notification toasts and email digests. */
  text: string;
  attachments?: TeamsAttachment[];
}

export interface TeamsAttachment {
  contentType: 'application/vnd.microsoft.card.adaptive';
  content: AdaptiveCardV14;
}

export interface TeamsSendActivityInput {
  serviceUrl: string;
  conversationId: string;
  body: TeamsOutboundActivity;
}

export interface TeamsSendActivityResult {
  ok: boolean;
  /** Activity id of the posted message. Required for follow-up PUT updates. */
  activityId?: string;
  error?: string;
}

export interface TeamsUpdateActivityInput {
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  body: TeamsOutboundActivity;
}

export interface TeamsUpdateActivityResult {
  ok: boolean;
  error?: string;
}
