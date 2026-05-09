/**
 * Google Chat REST API response shapes — projected to the fields the spec
 * and chunker actually read. Names follow the on-the-wire field casing
 * (camelCase, since Chat API uses Google's standard camelCase JSON).
 */

/**
 * A space (room or DM). The `name` field is the resource name, e.g.
 * `spaces/AAAA1234`. `displayName` is empty for direct messages.
 */
export interface GoogleChatSpace {
  /** Resource name, e.g. `spaces/AAAA1234`. */
  name: string;
  displayName?: string;
  /** `SPACE` (named room), `DM` (1:1), `GROUP_CHAT` (unnamed multi-user). */
  spaceType?: 'SPACE_TYPE_UNSPECIFIED' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
}

export interface GoogleChatUser {
  /** Resource name, e.g. `users/123456789`. */
  name: string;
  displayName?: string;
  /** 'HUMAN' or 'BOT' — the spec filters out BOT senders. */
  type?: 'TYPE_UNSPECIFIED' | 'HUMAN' | 'BOT';
}

export interface GoogleChatThread {
  /** Resource name, e.g. `spaces/AAA/threads/BBB`. */
  name: string;
}

export interface GoogleChatMessage {
  /** Resource name, e.g. `spaces/AAA/messages/CCC.CCC`. */
  name: string;
  sender?: GoogleChatUser;
  /** RFC 3339 timestamp. */
  createTime: string;
  /** RFC 3339 timestamp. Set when the message has been edited. */
  lastUpdateTime?: string;
  text?: string;
  thread?: GoogleChatThread;
}

export interface ListSpacesResponse {
  spaces?: GoogleChatSpace[];
  nextPageToken?: string;
}

export interface ListMessagesResponse {
  messages?: GoogleChatMessage[];
  nextPageToken?: string;
}
