/**
 * Microsoft Graph wire types — projected to the fields the Teams
 * ingestion connector actually reads. Camel-case keys match Graph's
 * v1.0 schema; do not rename.
 *
 * Reference: https://learn.microsoft.com/graph/api/resources/teams-api-overview
 *
 * Distinct from `app-types.ts` (which covers the Bot Framework Activity
 * envelope used by the conversational bot). These two surfaces don't
 * share any wire shape — Bot Framework is its own REST API and Graph
 * is its own REST API, even though both live under the same Azure AD
 * app registration.
 */

/** Generic Graph collection envelope: items + nextLink for pagination. */
export interface GraphCollection<T> {
  value: T[];
  /** Next page in the same query. Pass back as the next request URL. */
  '@odata.nextLink'?: string;
  /**
   * Delta token — present on the *last* page of a delta query (and
   * sometimes on intermediate pages instead of nextLink). Save this in
   * `connector_cursors.metadata.deltaLink` and pass it as the request
   * URL for the next incremental run.
   */
  '@odata.deltaLink'?: string;
}

export interface GraphOrganization {
  /** AAD tenant GUID. */
  id: string;
  displayName: string;
}

export interface GraphTeam {
  /** AAD group id; serves as the team's stable resource id. */
  id: string;
  displayName: string;
  description?: string;
  /** AAD tenant id, if Graph supplies it (some endpoints omit it). */
  tenantId?: string;
}

export interface GraphChannel {
  id: string;
  displayName: string;
  /**
   * Standard / private / shared. We only ingest from standard + private
   * (`shared` channels span tenants and have a different ACL story).
   */
  membershipType?: 'standard' | 'private' | 'shared';
  description?: string;
  webUrl?: string;
}

/** Chat resource — 1:1, group, or meeting. */
export interface GraphChat {
  id: string;
  topic?: string;
  /**
   * Discriminator. `oneOnOne` includes bot-DM chats (filter those out
   * at the connector layer). `meeting` is a chat attached to a scheduled
   * Teams meeting.
   */
  chatType: 'oneOnOne' | 'group' | 'meeting';
  webUrl?: string;
  /** ISO timestamp of last message. Useful for archived-chat pruning. */
  lastUpdatedDateTime?: string;
}

export interface GraphChatMessage {
  id: string;
  /** `null` for root messages, parent message id for thread replies. */
  replyToId?: string | null;
  /** ISO timestamp. */
  createdDateTime: string;
  /** ISO timestamp; present iff the message was edited after posting. */
  lastModifiedDateTime?: string;
  /**
   * `message` is normal content; `systemEventMessage` covers "joined
   * channel", "topic changed", etc. — skip those at the chunker.
   * `unknownFutureValue` is Graph's escape hatch for forward-compat;
   * also skip.
   */
  messageType: 'message' | 'chatEvent' | 'systemEventMessage' | 'unknownFutureValue';
  /**
   * Graph's body envelope. `contentType: 'html'` arrives from Outlook
   * actionable messages and Power Automate flows; the chunker strips
   * tags. `contentType: 'text'` is plain.
   */
  body?: { contentType: 'html' | 'text'; content?: string | null };
  from?: {
    user?: { id: string; displayName?: string; userIdentityType?: string };
    application?: { id: string; displayName?: string };
  };
  /** Deep link back to the message in the Teams client. */
  webUrl?: string;
  /**
   * Set on rows that represent a deleted message. The id is still
   * present (so we can delete the corresponding source_artifact row).
   */
  deletedDateTime?: string | null;
  /** `@odata.removed` envelope appears on deleted-via-delta entries. */
  '@removed'?: { reason: 'changed' | 'deleted' };
}

export interface GraphUser {
  /** AAD object id. */
  id: string;
  displayName?: string;
  userPrincipalName?: string;
  mail?: string;
}

/** Membership row returned by `/teams/{id}/members` and `/chats/{id}/members`. */
export interface GraphConversationMember {
  /** Membership row id (Graph internal). */
  id: string;
  displayName?: string;
  /**
   * AAD object id of the user (Graph nests it under different field
   * names depending on the endpoint — `userId` on the Team member,
   * `userId` on the Chat member; we normalize to `userId` at parse
   * time).
   */
  userId?: string;
  roles?: string[];
}
