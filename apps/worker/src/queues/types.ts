import { QUEUE_NAMES_BY_PROVIDER, type SyncProvider } from '@holo/sync-providers';

export const QUEUE_NAMES = {
  GITHUB_CODE_SYNC: 'github-code-sync',
  GITHUB_PROSE_SYNC: 'github-prose-sync',
  GITLAB_CODE_SYNC: 'gitlab-code-sync',
  GITLAB_PROSE_SYNC: 'gitlab-prose-sync',
  SLACK_SYNC: 'slack-sync',
  NOTION_SYNC: 'notion-sync',
  GRAIN_SYNC: 'grain-sync',
  PYLON_SYNC: 'pylon-sync',
  HUBSPOT_SYNC: 'hubspot-sync',
  LINEAR_SYNC: 'linear-sync',
  MINTLIFY_SYNC: 'mintlify-sync',
  PRISMIC_SYNC: 'prismic-sync',
  ZENDESK_SYNC: 'zendesk-sync',
  GOOGLEDRIVE_SYNC: 'googledrive-sync',
  AIRTABLE_SYNC: 'airtable-sync',
  GOOGLE_CHAT_SYNC: 'google-chat-sync',
  ASANA_SYNC: 'asana-sync',
  JIRA_SYNC: 'jira-sync',
  CONFLUENCE_SYNC: 'confluence-sync',
  STRIPE_SYNC: 'stripe-sync',
  SALESFORCE_SYNC: 'salesforce-sync',
  EMBED: 'embed',
  // Background queue for re-embedding legacy chunks under the migrated
  // OpenAI model (PR #128 → text-embedding-3-small). Kept separate from
  // EMBED so it doesn't compete with live ingest for OpenAI quota.
  EMBED_BACKFILL: 'embed-backfill',
  // Async cleanup after Disconnect — see @holo/sync-providers
  // DISCONNECT_CLEANUP_QUEUE for why this is split off the request thread.
  DISCONNECT_CLEANUP: 'disconnect-cleanup',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Compile-time guard: every queue named in @holo/sync-providers must also
// appear in QUEUE_NAMES (except 'embed', 'embed-backfill', and
// 'disconnect-cleanup', which have no provider). Adding a connector to
// the registry without wiring a @Processor here is a TS error, not a
// silent runtime drop into a queue no worker is listening on.
type RegistrySyncQueueName =
  (typeof QUEUE_NAMES_BY_PROVIDER)[SyncProvider][number];
type WorkerSyncQueueName = Exclude<
  QueueName,
  'embed' | 'embed-backfill' | 'disconnect-cleanup'
>;
type _RegistrySubsetOfWorker =
  RegistrySyncQueueName extends WorkerSyncQueueName ? true : never;
type _WorkerSubsetOfRegistry =
  WorkerSyncQueueName extends RegistrySyncQueueName ? true : never;
const _registrySubsetOfWorker: _RegistrySubsetOfWorker = true;
const _workerSubsetOfRegistry: _WorkerSubsetOfRegistry = true;
void _registrySubsetOfWorker;
void _workerSubsetOfRegistry;

export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  'github-code-sync': 1,
  'github-prose-sync': 3,
  'gitlab-code-sync': 1,
  'gitlab-prose-sync': 3,
  'slack-sync': 3,
  'notion-sync': 2,
  'grain-sync': 2,
  'pylon-sync': 2,
  'hubspot-sync': 2,
  'linear-sync': 2,
  'mintlify-sync': 2,
  'prismic-sync': 2,
  'zendesk-sync': 2,
  'googledrive-sync': 2,
  'airtable-sync': 2,
  'google-chat-sync': 3,
  'asana-sync': 2,
  'jira-sync': 2,
  'confluence-sync': 2,
  'stripe-sync': 2,
  'salesforce-sync': 2,
  embed: 5,
  // Backfill is intentionally serial: rewriting legacy chunks is one-shot
  // work that should never crowd live ingest off OpenAI.
  'embed-backfill': 1,
  // Disconnect cleanup: serial. Each job is a single cascading delete on
  // sources, which is itself heavy on the DB; running them in parallel
  // would just contend for the same locks.
  'disconnect-cleanup': 1,
};

export type SyncJobPayload = {
  sourceId: string;
  organizationId: string;
};

export type SyncCursor = {
  exists: boolean;
  metadata: Record<string, unknown>;
  latestSeenTs: Date | null;
};

export type SyncMode = 'full' | 'incremental' | 'code-initial' | 'code-incremental';
