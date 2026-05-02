/**
 * Minimal interface for listing Slack channels a user is a member of.
 *
 * Defined locally (rather than imported from @holo/connectors) to keep this
 * package free of a hard dep on the connectors package — the actual
 * SlackUserApiClient from @holo/connectors structurally satisfies this.
 */
export interface SlackChannelLister {
  usersConversations(opts?: { cursor?: string }): Promise<{
    channels: Array<{ id: string }>;
    nextCursor?: string;
  }>;
}

export async function resolveSlackSubjects(
  client: SlackChannelLister,
): Promise<string[]> {
  const subjects = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.usersConversations(cursor ? { cursor } : undefined);
    for (const ch of page.channels) subjects.add(`slack-channel:${ch.id}`);
    cursor = page.nextCursor;
  } while (cursor);
  return Array.from(subjects).sort();
}
