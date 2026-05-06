import { schema, type DB } from '@holo/db';

/**
 * Insert a (team_id, event_id) row into slack_event_dedupe. Returns true if
 * this is the first time we've seen the event (the worker should run), false
 * if the row already existed (a Slack retry — ack 200 and bail).
 *
 * Uses ON CONFLICT DO NOTHING + RETURNING so we get atomic check-and-set in a
 * single round trip. No race window between SELECT and INSERT.
 */
export async function tryClaimSlackEvent(
  db: DB,
  teamId: string,
  eventId: string,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.slackEventDedupe)
    .values({ teamId, eventId })
    .onConflictDoNothing({
      target: [schema.slackEventDedupe.teamId, schema.slackEventDedupe.eventId],
    })
    .returning({ teamId: schema.slackEventDedupe.teamId });
  return inserted.length > 0;
}
