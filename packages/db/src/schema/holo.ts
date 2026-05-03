import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  vector,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { encryptedText } from './encrypted-text';
import { user, organization } from './auth';

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const connectorCredentials = pgTable(
  'connector_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    provider: text('provider', {
      enum: ['github', 'slack', 'notion', 'grain', 'pylon', 'hubspot'],
    }).notNull(),
    accessToken: encryptedText('access_token'),
    refreshToken: encryptedText('refresh_token'),
    scope: text('scope'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status', { enum: ['active', 'refresh_failed', 'revoked'] })
      .notNull()
      .default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  },
  (t) => ({
    orgProviderIdx: index('connector_credentials_org_provider_idx').on(
      t.organizationId,
      t.provider,
    ),
    orgProviderUserUniq: uniqueIndex('connector_credentials_org_provider_user_uniq').on(
      t.organizationId,
      t.provider,
      t.userId,
    ),
  }),
);

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProviderIdx: index('sources_org_provider_idx').on(t.organizationId, t.provider),
    orgProviderExternalUniq: uniqueIndex('sources_org_provider_external_uniq').on(
      t.organizationId,
      t.provider,
      t.externalId,
    ),
  }),
);

export const sourceArtifacts = pgTable(
  'source_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    sourceKindFetchedIdx: index('source_artifacts_source_kind_fetched_idx').on(
      t.sourceId,
      t.kind,
      t.fetchedAt,
    ),
    sourceExternalUniq: uniqueIndex('source_artifacts_source_external_uniq').on(
      t.sourceId,
      t.externalId,
    ),
  }),
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceArtifactId: uuid('source_artifact_id')
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    contentTsvector: tsvector('content_tsvector'),
    embedding: vector('embedding', { dimensions: 1024 }),
    aclSubjects: text('acl_subjects')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    provider: text('provider').notNull(),
    sourceId: uuid('source_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerSourceKindIdx: index('chunks_provider_source_kind_idx').on(
      t.provider,
      t.sourceId,
      t.kind,
    ),
    orgIdx: index('chunks_org_idx').on(t.organizationId),
  }),
);

export const connectorCursors = pgTable(
  'connector_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    latestSeenTs: timestamp('latest_seen_ts', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status'),
  },
  (t) => ({
    sourceScopeIdx: index('connector_cursors_source_scope_idx').on(t.sourceId, t.scope),
    sourceScopeUniq: uniqueIndex('connector_cursors_source_scope_uniq').on(
      t.sourceId,
      t.scope,
    ),
  }),
);

export const apiToken = pgTable(
  'api_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // First 8 chars of the plaintext token (after the "holo_" prefix), for display.
    prefix: text('prefix').notNull(),
    // SHA-256 of the plaintext token. Plaintext is shown to the user once at creation.
    hashedToken: text('hashed_token').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    orgUserIdx: index('api_token_org_user_idx').on(t.organizationId, t.userId),
  }),
);
