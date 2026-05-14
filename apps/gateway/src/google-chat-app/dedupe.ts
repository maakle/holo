import { schema, type DB } from '@holo/db';

/**
 * Insert a (space_name, message_name) row into google_chat_event_dedupe.
 * Returns true if this is the first time we've seen the message (the worker
 * should run), false if the row already existed (a Google retry — ack 200
 * and bail).
 *
 * Single round-trip ON CONFLICT DO NOTHING + RETURNING, same shape as
 * `tryClaimSlackEvent`. No race window.
 */
export async function tryClaimGoogleChatEvent(
  db: DB,
  spaceName: string,
  messageName: string,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.googleChatEventDedupe)
    .values({ spaceName, messageName })
    .onConflictDoNothing({
      target: [
        schema.googleChatEventDedupe.spaceName,
        schema.googleChatEventDedupe.messageName,
      ],
    })
    .returning({ spaceName: schema.googleChatEventDedupe.spaceName });
  return inserted.length > 0;
}
