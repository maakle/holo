import { schema, type DB } from '@holo/db';

/**
 * Insert a (tenant_id, activity_id) row into teams_event_dedupe.
 * Returns true if this is the first time we've seen the activity (the
 * worker should run), false if the row already existed (a Microsoft
 * retry — ack 200 and bail).
 *
 * Microsoft's 15s ack deadline + frequent retries on cold-start
 * latency make dedupe essential — the same activity can be delivered
 * 3–5 times during a worker boot.
 *
 * Single round-trip ON CONFLICT DO NOTHING + RETURNING, same shape as
 * `tryClaimSlackEvent` and `tryClaimGoogleChatEvent`. No race window.
 */
export async function tryClaimTeamsActivity(
  db: DB,
  tenantId: string,
  activityId: string,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.teamsEventDedupe)
    .values({ tenantId, activityId })
    .onConflictDoNothing({
      target: [
        schema.teamsEventDedupe.tenantId,
        schema.teamsEventDedupe.activityId,
      ],
    })
    .returning({ tenantId: schema.teamsEventDedupe.tenantId });
  return inserted.length > 0;
}
