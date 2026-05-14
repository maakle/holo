/**
 * Slack API request/response shapes — projected to the fields the spec and
 * the Slack bot actually read.
 */

export interface SlackMember {
  id: string;
  real_name: string;
  is_bot: boolean;
  name?: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

export interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  reply_count?: number;
}

/** Slack message-content block (Block Kit). */
export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Slack message metadata. Slack round-trips this to `block_actions`
 * payloads when a button on the message is clicked, so we use it to stash
 * the full source list with the answer — avoids a DB lookup on every
 * "Show sources" click.
 */
export interface SlackMessageMetadata {
  event_type: string;
  event_payload: Record<string, unknown>;
}

export interface SlackPostMessageInput {
  channel: string;
  text: string;
  thread_ts?: string;
  blocks?: SlackBlock[];
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  metadata?: SlackMessageMetadata;
}

export interface SlackPostMessageResult {
  ok: boolean;
  channel?: string;
  ts?: string;
  error?: string;
}
