// Single source of truth for the providers Holo can sync.
//
// Adding a new connector? Append it here and add an entry to
// QUEUE_NAMES_BY_PROVIDER below. Every other surface — the Drizzle schema
// enum, the dashboard's bulk-status route, the CLI `holo sync` command,
// the worker's queue topology — derives from these constants. Diverging
// silently drops new connectors out of the bulk-status poll (symptom: the
// connection wizard's first-sync step flashes "Sync finished — no new
// content" while the worker is happily indexing) and routes jobs into
// queues no worker is listening on.
//
// See CONTRIBUTING.md § "Adding a connector" for the full registration list.
export const SYNC_PROVIDERS = [
  'github',
  'gitlab',
  'slack',
  'notion',
  'grain',
  'pylon',
  'hubspot',
  'linear',
  'mintlify',
  'zendesk',
  'googledrive',
  'airtable',
] as const;

export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

export function isSyncProvider(value: string): value is SyncProvider {
  return (SYNC_PROVIDERS as readonly string[]).includes(value);
}

/** Human-readable list for HoloError fix strings. */
export const SYNC_PROVIDERS_FIX_HINT = `Use one of: ${SYNC_PROVIDERS.join(', ')}.`;

// BullMQ queue names per provider. The worker listens on every name in this
// map; the dashboard's bulk-status route polls every name; the CLI enqueues
// jobs onto every name. A missing or extra entry will desync all three.
//
// `as const satisfies` preserves the literal queue names so the worker can
// type-assert that QUEUE_NAMES covers exactly this set.
export const QUEUE_NAMES_BY_PROVIDER = {
  github: ['github-code-sync', 'github-prose-sync'],
  gitlab: ['gitlab-code-sync', 'gitlab-prose-sync'],
  slack: ['slack-sync'],
  notion: ['notion-sync'],
  grain: ['grain-sync'],
  pylon: ['pylon-sync'],
  hubspot: ['hubspot-sync'],
  linear: ['linear-sync'],
  mintlify: ['mintlify-sync'],
  zendesk: ['zendesk-sync'],
  googledrive: ['googledrive-sync'],
  airtable: ['airtable-sync'],
} as const satisfies Record<SyncProvider, readonly string[]>;

export type SyncQueueName =
  (typeof QUEUE_NAMES_BY_PROVIDER)[SyncProvider][number];

/** Flat list of every BullMQ queue name driven by a sync provider. */
export const SYNC_QUEUE_NAMES: readonly string[] = Object.values(
  QUEUE_NAMES_BY_PROVIDER,
).flat();

export function queueNamesFor(provider: SyncProvider): readonly string[] {
  return QUEUE_NAMES_BY_PROVIDER[provider];
}
