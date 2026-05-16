/**
 * Google Chat App (bot) request + response shapes — projected to the fields
 * the inbound handler and outbound message-builder actually read.
 *
 * Distinct from the read-only sync types in `./types.ts`: the sync path
 * reads space history via the REST API as an impersonated user, while the
 * App path receives webhooks and posts replies as the bot identity. The two
 * surfaces share a provider but not a code path.
 *
 * Camel-case keys mirror Google's wire format; do not rename.
 */

import type { GoogleChatThread, GoogleChatUser } from './types';

/**
 * Top-level envelope Google Chat POSTs at the configured HTTP endpoint.
 *
 * Reference: https://developers.google.com/workspace/chat/api/reference/rest/v1/Event
 * The `type` discriminates the event kind; the inbound handler only acts on
 * `MESSAGE`, `ADDED_TO_SPACE`, and `REMOVED_FROM_SPACE`. Other types ack 200
 * without work.
 */
export interface GoogleChatAppEvent {
  /** ISO 8601 timestamp from Google. */
  eventTime: string;
  type: GoogleChatAppEventType;
  space: GoogleChatAppSpace;
  /**
   * The asker. `domainId` here is the Workspace tenant identifier — the
   * inbound resolver maps it to a Holo org via `google_chat_workspaces`.
   * Top-level `customerNumber` and `space.customer` are NOT populated by
   * Google's current Chat events API, so do not depend on them.
   */
  user?: GoogleChatUser;
  message?: GoogleChatAppMessage;
}

export type GoogleChatAppEventType =
  | 'MESSAGE'
  | 'ADDED_TO_SPACE'
  | 'REMOVED_FROM_SPACE'
  | 'CARD_CLICKED';

/**
 * Subset of `Space` returned in event payloads. `type` distinguishes 1:1
 * DMs from rooms — Slack's `app_mention` vs `message_im` split maps to
 * `ROOM` vs `DM` here. Google's enum names are stable.
 */
export interface GoogleChatAppSpace {
  name: string;
  type?: 'ROOM' | 'DM';
  /** Older payloads use `singleUserBotDm` to flag a 1:1 with the bot. */
  singleUserBotDm?: boolean;
}

/**
 * Subset of `Message` returned in event payloads. `name` is the stable
 * resource identifier (`spaces/AAA/messages/BBB`) we use for dedupe and as
 * the patch target. `argumentText` strips the bot's leading @mention; we
 * prefer it over raw `text` so the agent doesn't have to parse mentions.
 */
export interface GoogleChatAppMessage {
  name: string;
  sender?: GoogleChatUser;
  createTime: string;
  text?: string;
  /** Text with the leading bot @mention stripped. Use this for the agent query. */
  argumentText?: string;
  thread?: GoogleChatThread;
  /** Set on messages the bot itself authored — filter at the gateway. */
  type?: 'TEXT' | 'SYSTEM_MESSAGE';
}

/**
 * Cards v2 message body for outbound replies. Narrow on purpose — v1 of
 * the bot replies with a single text-section card; richer surfaces (buttons,
 * images, dialogs) come later. Documenting the dialect here lets future
 * additions stay typed.
 *
 * Reference: https://developers.google.com/workspace/chat/api/guides/v2/message-formats/cards
 */
export interface GoogleChatCardV2Message {
  /** Fallback text shown in notifications and Chat preview. Required. */
  text?: string;
  cardsV2?: GoogleChatCardV2[];
  /**
   * Reply threading hint. Set `threadKey` on the parent (mention payload) so
   * the reply lands in the same thread; or pass `thread.name` to attach to
   * an existing thread fetched from the inbound event.
   */
  thread?: GoogleChatThread & { threadKey?: string };
}

export interface GoogleChatCardV2 {
  /** Per-message card id. We use a UUID for traceability. */
  cardId: string;
  card: GoogleChatCard;
}

export interface GoogleChatCard {
  header?: GoogleChatCardHeader;
  sections?: GoogleChatCardSection[];
}

export interface GoogleChatCardHeader {
  title: string;
  subtitle?: string;
}

export interface GoogleChatCardSection {
  header?: string;
  widgets: GoogleChatCardWidget[];
  /**
   * When true, Chat renders an automatic "Show more/less" toggle that hides
   * widgets beyond `uncollapsibleWidgetsCount`. Used for the answer's
   * Sources block so a 15-source list doesn't dominate the reply.
   */
  collapsible?: boolean;
  uncollapsibleWidgetsCount?: number;
}

export type GoogleChatCardWidget =
  | { textParagraph: { text: string } }
  | { decoratedText: { text: string; topLabel?: string; bottomLabel?: string } };

export interface GoogleChatCreateMessageInput {
  /** Resource name of the parent space, e.g. `spaces/AAA`. */
  parent: string;
  /** Either `text` only (simple) or `cardsV2` for rich. Use `text` as fallback even when sending cards. */
  body: GoogleChatCardV2Message;
  /** `REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` for in-thread replies; omit for new threads. */
  messageReplyOption?: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' | 'REPLY_MESSAGE_OR_FAIL';
}

export interface GoogleChatCreateMessageResult {
  ok: boolean;
  message?: { name: string; thread?: { name: string } };
  error?: string;
}

export interface GoogleChatPatchMessageInput {
  /** Full message resource name, e.g. `spaces/AAA/messages/BBB`. */
  name: string;
  body: GoogleChatCardV2Message;
}

export interface GoogleChatPatchMessageResult {
  ok: boolean;
  message?: { name: string };
  error?: string;
}
