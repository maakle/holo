import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  vector,
  index,
  uniqueIndex,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { encryptedText } from './encrypted-text';
import { user, organization } from './auth';

export const customTools = pgTable(
  'custom_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    command: text('command').notNull(),
    argsTemplate: text('args_template').array().notNull().default(sql`'{}'::text[]`),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
    envAllowlist: text('env_allowlist').array().notNull().default(sql`'{}'::text[]`),
    scope: text('scope'),
    readOnly: boolean('read_only').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    maxOutputBytes: integer('max_output_bytes').notNull().default(262144),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('custom_tools_org_name_uniq').on(t.organizationId, t.name),
    orgIdx: index('custom_tools_org_idx').on(t.organizationId),
  }),
);

export const slackUserCredentials = pgTable(
  'slack_user_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    slackUserId: text('slack_user_id').notNull(),
    accessTokenEncrypted: encryptedText('access_token_encrypted').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdUniq: uniqueIndex('slack_user_credentials_user_id_uniq').on(t.userId),
    orgIdx: index('slack_user_credentials_org_idx').on(t.organizationId),
  }),
);

export const userSubjectsCache = pgTable(
  'user_subjects_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    source: text('source').notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userSubjectUniq: uniqueIndex('user_subjects_cache_user_subject_uniq').on(t.userId, t.subject),
    userIdx: index('user_subjects_cache_user_idx').on(t.userId),
  }),
);

export const procedureEpisodes = pgTable(
  'procedure_episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceArtifactIds: uuid('source_artifact_ids').array().notNull(),
    centroidEmbedding: vector('centroid_embedding', { dimensions: 1024 }),
    entityKey: text('entity_key'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgLastSeenIdx: index('procedure_episodes_org_last_seen_idx').on(
      t.organizationId,
      t.lastSeenAt,
    ),
    orgEntityIdx: index('procedure_episodes_org_entity_idx').on(t.organizationId, t.entityKey),
  }),
);

export const procedureProposals = pgTable(
  'procedure_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    episodeId: uuid('episode_id')
      .notNull()
      .references(() => procedureEpisodes.id, { onDelete: 'cascade' }),
    proposedSlug: text('proposed_slug').notNull(),
    proposedName: text('proposed_name').notNull(),
    summary: text('summary').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'superseded'] })
      .notNull()
      .default('pending'),
    rejectionReasonHash: text('rejection_reason_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusCreatedIdx: index('procedure_proposals_org_status_created_idx').on(
      t.organizationId,
      t.status,
      t.createdAt,
    ),
    orgEpisodePendingUniq: uniqueIndex('procedure_proposals_org_episode_pending_uniq')
      .on(t.organizationId, t.episodeId)
      .where(sql`${t.status} = 'pending'`),
  }),
);

/**
 * Slack delivers each event with an `event_id` and retries on non-2xx or
 * timeout. Insert into this table inside the events handler — a unique-key
 * collision means we've already processed that event and should ack with 200
 * without re-running the worker job. Rows TTL out via the cleanup worker
 * (rows older than 24h can be deleted; Slack stops retrying after 1 hour).
 */
export const slackEventDedupe = pgTable(
  'slack_event_dedupe',
  {
    teamId: text('team_id').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('slack_event_dedupe_team_event_uniq').on(t.teamId, t.eventId),
    receivedAtIdx: index('slack_event_dedupe_received_at_idx').on(t.receivedAt),
  }),
);

export const procedureProposalDecisions = pgTable(
  'procedure_proposal_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => procedureProposals.id, { onDelete: 'cascade' }),
    decision: text('decision', { enum: ['accept', 'reject'] }).notNull(),
    finalSlug: text('final_slug'),
    decidedBy: uuid('decided_by').notNull().references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgDecidedAtIdx: index('procedure_proposal_decisions_org_decided_at_idx').on(
      t.organizationId,
      t.decidedAt,
    ),
  }),
);

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUserUpdatedIdx: index('chat_conversations_org_user_updated_idx').on(
      t.organizationId,
      t.userId,
      t.updatedAt,
    ),
  }),
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    text: text('text').notNull(),
    toolCalls: jsonb('tool_calls'),
    modelCalls: integer('model_calls'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationCreatedIdx: index('chat_messages_conversation_created_idx').on(
      t.conversationId,
      t.createdAt,
    ),
  }),
);
