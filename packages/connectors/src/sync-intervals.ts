import type { SyncProvider } from '@holo/sync-providers';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Default sync cadence per provider. Each `create*Spec()` factory reads
 * its entry to populate `spec.sync.intervalMs`, so the spec object and
 * this map stay in lockstep.
 *
 * Cadence is currently a Holo-team decision (not customer-tunable). Values
 * trade OpenAI embedding cost against retrieval freshness:
 *   - Slack/Linear: high churn, surfaced in chat retrieval → 4h
 *   - Tickets/CRM/code: 6h is responsive enough for the daily-driver flows
 *   - Meeting recordings, handbook-style docs: low churn → 12–24h
 *
 * If the cadence/cost tradeoff for a provider changes, edit it here. The
 * worker scheduler and the manage-sheet UI both derive from this map.
 */
export const SYNC_INTERVAL_MS_BY_PROVIDER: Record<SyncProvider, number> = {
  slack: 4 * HOUR_MS,
  linear: 4 * HOUR_MS,
  zendesk: 6 * HOUR_MS,
  hubspot: 6 * HOUR_MS,
  pylon: 6 * HOUR_MS,
  github: 6 * HOUR_MS,
  grain: 12 * HOUR_MS,
  notion: 24 * HOUR_MS,
  mintlify: 24 * HOUR_MS,
  googledrive: 6 * HOUR_MS,
};

export function getSyncIntervalMs(provider: SyncProvider): number {
  return SYNC_INTERVAL_MS_BY_PROVIDER[provider];
}
