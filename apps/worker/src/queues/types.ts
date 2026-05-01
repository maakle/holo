export const QUEUE_NAMES = {
  GITHUB_CODE_SYNC: 'github-code-sync',
  GITHUB_PROSE_SYNC: 'github-prose-sync',
  SLACK_SYNC: 'slack-sync',
  NOTION_SYNC: 'notion-sync',
  GRAIN_SYNC: 'grain-sync',
  PYLON_SYNC: 'pylon-sync',
  EMBED: 'embed',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  'github-code-sync': 1,
  'github-prose-sync': 3,
  'slack-sync': 3,
  'notion-sync': 2,
  'grain-sync': 2,
  'pylon-sync': 2,
  embed: 5,
};

// 6 hours, per BullMQ topology table.
export const SYNC_REPEAT_EVERY_MS = 6 * 60 * 60 * 1000;

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
