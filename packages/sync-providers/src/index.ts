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
  'prismic',
  'zendesk',
  'webcrawl',
  'googledrive',
  'airtable',
  'google-chat',
  'asana',
  'jira',
  'confluence',
  'stripe',
  'salesforce',
  'teams',
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
  prismic: ['prismic-sync'],
  zendesk: ['zendesk-sync'],
  webcrawl: ['webcrawl-sync'],
  googledrive: ['googledrive-sync'],
  airtable: ['airtable-sync'],
  'google-chat': ['google-chat-sync'],
  asana: ['asana-sync'],
  jira: ['jira-sync'],
  confluence: ['confluence-sync'],
  stripe: ['stripe-sync'],
  salesforce: ['salesforce-sync'],
  teams: ['teams-sync'],
} as const satisfies Record<SyncProvider, readonly string[]>;

export type SyncQueueName =
  (typeof QUEUE_NAMES_BY_PROVIDER)[SyncProvider][number];

/** Flat list of every BullMQ queue name driven by a sync provider. */
export const SYNC_QUEUE_NAMES: readonly string[] = Object.values(
  QUEUE_NAMES_BY_PROVIDER,
).flat();

/**
 * Single shared queue for async cleanup after disconnect. The DELETE route
 * does the fast, bounded work synchronously (token revoke, remote uninstall,
 * credential/installation/SA row deletion, BullMQ drain) and enqueues one
 * job here per disconnect to handle the slow part: deleting `sources` for
 * (org, provider), which cascades through `source_artifacts` → `chunks`
 * and can take minutes for large workspaces.
 */
export const DISCONNECT_CLEANUP_QUEUE = 'disconnect-cleanup';

export type DisconnectCleanupJobPayload = {
  jobRowId: string;
  organizationId: string;
  provider: SyncProvider;
};

export function queueNamesFor(provider: SyncProvider): readonly string[] {
  return QUEUE_NAMES_BY_PROVIDER[provider];
}

/**
 * OAuth scopes the Google service account requires per provider, surfaced
 * here (in a client-safe constants package) so both the worker — which mints
 * delegated tokens via JWT bearer — and the wizard UI — which displays the
 * scopes for admins to paste into Workspace Admin Console → Domain-wide
 * Delegation — read from a single source. If these drift from what the
 * worker requests at mint time, Google rejects with `invalid_grant`.
 */
export const GOOGLEDRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export const GOOGLE_CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'openid',
  'email',
] as const;

/**
 * Scope used when authenticating as the Holo Chat App itself (no user
 * impersonation). Reads are scoped to spaces where the bot is a member.
 * Used by SA rows with `auth_mode = 'app'` — the bot-in-space model that
 * replaces domain-wide delegation as the default for new connections.
 */
export const GOOGLE_CHAT_APP_SCOPES = [
  'https://www.googleapis.com/auth/chat.bot',
] as const;

export const GOOGLE_SERVICE_ACCOUNT_SCOPES = {
  googledrive: GOOGLEDRIVE_SCOPES,
  'google-chat': GOOGLE_CHAT_SCOPES,
} as const satisfies Partial<Record<SyncProvider, readonly string[]>>;
