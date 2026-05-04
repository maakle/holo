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
  integer,
  boolean,
  bigint,
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
    contentHash: text('content_hash').notNull(),
    embeddingModel: text('embedding_model').notNull().default('openai-3-large'),
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
    contentHashIdx: uniqueIndex('chunks_content_hash_idx').on(t.organizationId, t.contentHash),
    metadataPrIdx: index('chunks_metadata_pr_idx').using('gin', sql`${t.metadata} jsonb_path_ops`),
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
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => ({
    sourceScopeIdx: index('connector_cursors_source_scope_idx').on(t.sourceId, t.scope),
    sourceScopeUniq: uniqueIndex('connector_cursors_source_scope_uniq').on(
      t.sourceId,
      t.scope,
    ),
  }),
);

export const connectorAllowlists = pgTable(
  'connector_allowlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    provider: text('provider').notNull(),
    pattern: text('pattern').notNull(),
    patternKind: text('pattern_kind', { enum: ['glob', 'exact_id'] }).notNull(),
    decision: text('decision', { enum: ['include', 'exclude'] }).notNull().default('include'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    notes: text('notes'),
  },
  (t) => ({
    orgProviderIdx: index('connector_allowlists_org_provider_idx').on(
      t.organizationId,
      t.provider,
    ),
  }),
);

export const githubInstallations = pgTable(
  'github_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    installationId: bigint('installation_id', { mode: 'number' }).notNull(),
    accountLogin: text('account_login').notNull(),
    accountType: text('account_type').notNull(),
    accountId: bigint('account_id', { mode: 'number' }).notNull(),
    repositorySelection: text('repository_selection').notNull(),
    installedByUserId: uuid('installed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  },
  (t) => ({
    orgInstallUniq: uniqueIndex('github_installations_org_install_uniq').on(
      t.organizationId,
      t.installationId,
    ),
    installIdx: index('github_installations_install_idx').on(t.installationId),
  }),
);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    version: integer('version').notNull().default(1),
    status: text('status', { enum: ['draft', 'active', 'archived'] })
      .notNull()
      .default('draft'),
    content: text('content').notNull(),
    sourceArtifactIds: uuid('source_artifact_ids').array().notNull().default(sql`'{}'::uuid[]`),
    fingerprint: text('fingerprint').notNull(),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    toolAllowlist: text('tool_allowlist').array().notNull().default(sql`'{}'::text[]`),
    executable: boolean('executable').notNull().default(false),
  },
  (t) => ({
    orgStatusIdx: index('skills_org_status_idx').on(t.organizationId, t.status),
    orgSlugVersionUniq: uniqueIndex('skills_org_slug_version_uniq').on(
      t.organizationId,
      t.slug,
      t.version,
    ),
  }),
);

export const skillLabels = pgTable(
  'skill_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    sourceArtifactId: uuid('source_artifact_id')
      .notNull()
      .references(() => sourceArtifacts.id, { onDelete: 'cascade' }),
    skillSlug: text('skill_slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgSlugIdx: index('skill_labels_org_slug_idx').on(t.organizationId, t.skillSlug),
    orgArtifactSlugUniq: uniqueIndex('skill_labels_org_artifact_slug_uniq').on(
      t.organizationId,
      t.sourceArtifactId,
      t.skillSlug,
    ),
  }),
);

export const mcpInvocations = pgTable(
  'mcp_invocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    agentIdentity: text('agent_identity'),
    toolName: text('tool_name').notNull(),
    inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull(),
    outputJson: jsonb('output_json').$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('mcp_invocations_org_created_idx').on(t.organizationId, t.createdAt),
    orgToolIdx: index('mcp_invocations_org_tool_idx').on(t.organizationId, t.toolName),
  }),
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    tokenHash: text('token_hash').notNull().unique(),
    label: text('label').notNull().default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    orgUserIdx: index('api_tokens_org_user_idx').on(t.organizationId, t.userId),
  }),
);

export const publishedSkills = pgTable(
  'published_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    redactedContent: text('redacted_content').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    publishedAtIdx: index('published_skills_published_at_idx').on(t.publishedAt),
    skillIdUniq: uniqueIndex('published_skills_skill_id_uniq').on(t.skillId),
  }),
);

export const skillRuns = pgTable(
  'skill_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    triggeredBy: uuid('triggered_by').references(() => user.id),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    steps: jsonb('steps').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    status: text('status', { enum: ['running', 'completed', 'failed'] })
      .notNull()
      .default('running'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    orgStartedAtIdx: index('skill_runs_org_started_at_idx').on(t.organizationId, t.startedAt),
    skillIdx: index('skill_runs_skill_idx').on(t.skillId),
  }),
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    userId: uuid('user_id').references(() => user.id),
    eventType: text('event_type').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedAtIdx: index('audit_events_org_created_at_idx').on(t.organizationId, t.createdAt.desc()),
    eventTypeIdx: index('audit_events_event_type_idx').on(t.organizationId, t.eventType),
  }),
);

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    clientId: text('client_id').notNull(),
    clientName: text('client_name').notNull(),
    redirectUris: text('redirect_uris').array().notNull().default(sql`'{}'::text[]`),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clientIdUniq: uniqueIndex('oauth_clients_client_id_uniq').on(t.clientId),
    orgIdx: index('oauth_clients_org_idx').on(t.organizationId),
  }),
);

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

export const oauthAuthCodes = pgTable(
  'oauth_auth_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex('oauth_auth_codes_code_uniq').on(t.code),
    expiresAtIdx: index('oauth_auth_codes_expires_at_idx').on(t.expiresAt),
  }),
);

export const oauthAccessTokens = pgTable(
  'oauth_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUniq: uniqueIndex('oauth_access_tokens_token_hash_uniq').on(t.tokenHash),
    userIdExpiresIdx: index('oauth_access_tokens_user_expires_idx').on(t.userId, t.expiresAt),
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
