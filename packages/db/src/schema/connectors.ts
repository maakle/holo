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
  bigint,
  numeric,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { SYNC_PROVIDERS } from '@holo/sync-providers';
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
    provider: text('provider', { enum: SYNC_PROVIDERS }).notNull(),
    accessToken: encryptedText('access_token'),
    refreshToken: encryptedText('refresh_token'),
    scope: text('scope'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status', { enum: ['active', 'refresh_failed', 'revoked'] })
      .notNull()
      .default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
    // Set when an org installs Slack via their own custom Slack app instead of
    // the shared Holo app. Null = installed via the shared app (env-var
    // credentials). When set, OAuth refresh and webhook signature
    // verification must use the matching slack_app_configs row's
    // client_secret / signing_secret rather than the global env vars.
    slackAppConfigId: uuid('slack_app_config_id'),
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

/**
 * Customer/end-customer entity from the POV of a Holo tenant. One row per
 * HubSpot Company / Pylon Account / Salesforce Account, merged by per-source
 * external id (organization-scoped). Stamped on chunks at ingest so retrieval
 * can filter by customer without a dedicated UI surface. Resolution is
 * implicit: connectors emit metadata hints (`customer_account_upsert` /
 * `customer_account_hint`) and the worker's embed-insert path upserts/looks
 * up the row before the bulk chunk insert.
 *
 * Distinct from `organization` (the Holo tenant — our paying customer) and
 * from Better Auth's `account` table (the user's OAuth identity).
 */
export const customerAccounts = pgTable(
  'customer_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Best-guess canonical domain (e.g. 'skello.io'). Used as the primary
     * domain-inference key; secondary domains live in `domains`. */
    primaryDomain: text('primary_domain'),
    domains: text('domains').array().notNull().default(sql`'{}'::text[]`),
    /** Free-form names this account is known by (e.g. ['Skello', 'Skello SA',
     * 'cust-skello']). The resolver matches case-insensitively. */
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    hubspotCompanyId: text('hubspot_company_id'),
    pylonAccountId: text('pylon_account_id'),
    salesforceAccountId: text('salesforce_account_id'),
    arrAmount: numeric('arr_amount', { precision: 14, scale: 2 }),
    arrCurrency: text('arr_currency'),
    tier: text('tier'),
    ownerEmail: text('owner_email'),
    lifecycleStage: text('lifecycle_stage'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('customer_accounts_org_idx').on(t.organizationId),
    orgPrimaryDomainIdx: index('customer_accounts_org_primary_domain_idx').on(
      t.organizationId,
      t.primaryDomain,
    ),
    domainsGinIdx: index('customer_accounts_domains_gin_idx').using('gin', t.domains),
    aliasesGinIdx: index('customer_accounts_aliases_gin_idx').using('gin', t.aliases),
    // Partial uniques: a HubSpot/Pylon/Salesforce id may be NULL on accounts
    // that originated in the other CRMs, but when present it pins one row.
    orgHubspotUniq: uniqueIndex('customer_accounts_org_hubspot_uniq')
      .on(t.organizationId, t.hubspotCompanyId)
      .where(sql`${t.hubspotCompanyId} IS NOT NULL`),
    orgPylonUniq: uniqueIndex('customer_accounts_org_pylon_uniq')
      .on(t.organizationId, t.pylonAccountId)
      .where(sql`${t.pylonAccountId} IS NOT NULL`),
    orgSalesforceUniq: uniqueIndex('customer_accounts_org_salesforce_uniq')
      .on(t.organizationId, t.salesforceAccountId)
      .where(sql`${t.salesforceAccountId} IS NOT NULL`),
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
    embeddingModel: text('embedding_model').notNull().default('openai-3-small'),
    contentTsvector: tsvector('content_tsvector'),
    embedding: vector('embedding', { dimensions: 1024 }),
    aclSubjects: text('acl_subjects')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    provider: text('provider').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** Resolved customer account this chunk belongs to. Stamped at ingest by
     * the embed-insert path from metadata hints; NULL when no hint matched
     * (e.g. chunks from connectors that have no customer notion). ON DELETE
     * SET NULL so deleting a customer_accounts row doesn't cascade-drop the
     * chunks — they just become unassigned. */
    accountId: uuid('account_id').references(() => customerAccounts.id, {
      onDelete: 'set null',
    }),
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
    orgAccountIdx: index('chunks_org_account_idx')
      .on(t.organizationId, t.accountId)
      .where(sql`${t.accountId} IS NOT NULL`),
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

// Durable history of every connector sync attempt. The worker writes a row
// in `running` state when a job starts and updates it to `ok` / `failed` on
// finish. Orphaned `running` rows (worker crash, BullMQ stall) are swept to
// `stalled` on worker boot. Source-of-truth for the connections page run
// list — outlives Redis flushes.
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    queueName: text('queue_name').notNull(),
    jobId: text('job_id').notNull(),
    status: text('status', { enum: ['running', 'ok', 'failed', 'stalled', 'cancelled'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    artifactCount: integer('artifact_count'),
    /**
     * Per-kind breakdown of what the run did. Shape:
     *   { [kind]: { new: number; deduped: number } }
     * `new` = chunks newly inserted (sum equals `artifactCount`).
     * `deduped` = chunks dropped because their content_hash already existed
     * for the org (cross-sync rediscovery + intra-sync duplicates).
     * NULL on rows written before migration 0028.
     */
    breakdown: jsonb('breakdown').$type<Record<string, { new: number; deduped: number }>>(),
    errorCode: text('error_code'),
    errorProblem: text('error_problem'),
    errorCause: text('error_cause'),
    skipReason: text('skip_reason'),
    progressCurrent: integer('progress_current'),
    progressTotal: integer('progress_total'),
    progressMessage: text('progress_message'),
  },
  (t) => ({
    queueJobUniq: uniqueIndex('sync_runs_queue_job_uniq').on(t.queueName, t.jobId),
    orgProviderStartedIdx: index('sync_runs_org_provider_started_idx').on(
      t.organizationId,
      t.provider,
      t.startedAt,
    ),
    sourceStartedIdx: index('sync_runs_source_started_idx').on(t.sourceId, t.startedAt),
    statusStartedIdx: index('sync_runs_status_started_idx').on(t.status, t.startedAt),
  }),
);

/**
 * Workspace-scoped Google service account credentials. One row per
 * (organization, provider) — the row is the org's connection to that Google
 * surface and replaces per-user OAuth for googledrive + google-chat.
 *
 * `keyJson` holds the encrypted JSON key downloaded from the Google Cloud
 * Console (service account → keys → add key). `impersonationEmail` is the
 * Workspace user the SA acts as via domain-wide delegation; the bridge mints
 * a delegated access token before each sync via the JWT bearer flow.
 *
 * No userId — service accounts are organization-level credentials, not
 * user-level. The installer is recorded for audit only.
 */
export const connectorServiceAccounts = pgTable(
  'connector_service_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: SYNC_PROVIDERS }).notNull(),
    /** Encrypted JSON key blob (the full file from Google Cloud Console). */
    keyJson: encryptedText('key_json').notNull(),
    /** Workspace user the SA impersonates via DWD (e.g. admin@company.com). */
    impersonationEmail: text('impersonation_email').notNull(),
    /** Service account's client_email — surfaced to admins on the settings page so they know which SA to grant DWD to. Derived from keyJson at install time, kept here so we don't have to decrypt to display. */
    serviceAccountEmail: text('service_account_email').notNull(),
    /** SA client_id from the JSON key. The Workspace admin pastes this into Admin Console → Security → API Controls → Domain-wide Delegation. Pre-extracted so the dashboard can show it without decrypting. */
    serviceAccountClientId: text('service_account_client_id').notNull(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
    installedByUserId: uuid('installed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  },
  (t) => ({
    orgProviderUniq: uniqueIndex('connector_service_accounts_org_provider_uniq').on(
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

// Tracks an in-flight async cleanup after the user disconnects a connector.
// The DELETE route inserts a row, runs the bounded fast bits sync (revoke
// token, remote uninstall, drop credential/installation/SA rows, drain
// BullMQ), then enqueues a `disconnect-cleanup` job that deletes the
// `sources` rows for that (org, provider) — which cascades through
// `source_artifacts` → `chunks` and is the slow part for large workspaces.
// While `finished_at IS NULL` the dashboard renders a "Disconnecting…"
// state and re-connects are blocked.
export const connectorDisconnectJobs = pgTable(
  'connector_disconnect_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => ({
    orgProviderPendingUniq: uniqueIndex(
      'connector_disconnect_jobs_org_provider_pending_uniq',
    )
      .on(t.organizationId, t.provider)
      .where(sql`${t.finishedAt} IS NULL`),
  }),
);

/**
 * Per-organization custom Slack app credentials — the "bring your own Slack
 * bot" path. EE only. When a row exists for an org, all Slack OAuth installs
 * for that org go against this app's client_id/secret (so the bot's name,
 * icon, scopes, and manifest are owned by the customer), and inbound events
 * arrive at /slack/events/<organizationId> where they're HMAC-verified with
 * this signing_secret. One app per org (uniq on organizationId) — multiple
 * Slack workspaces installed under the same org share the same custom app,
 * which matches Slack's "distribute to multiple workspaces" model.
 *
 * Orgs without a row continue to use the shared Holo Slack app sourced from
 * SLACK_CONNECTOR_* env vars; the new column on connector_credentials
 * records which path each install used so we can route refresh and signing
 * lookups correctly.
 */
export const slackAppConfigs = pgTable(
  'slack_app_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Slack-issued App ID (Axxxx…) — surfaced in admin UI so customers can confirm they pasted the right credentials. */
    appId: text('app_id'),
    clientId: text('client_id').notNull(),
    clientSecret: encryptedText('client_secret').notNull(),
    signingSecret: encryptedText('signing_secret').notNull(),
    /** Display label shown on the connections page when this app is active. Defaults to the org name on create. */
    displayName: text('display_name'),
    createdByUserId: uuid('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUniq: uniqueIndex('slack_app_configs_org_uniq').on(t.organizationId),
  }),
);

// Single-use grant rows that bridge an OAuth callback (which runs on
// WEB_PUBLIC_URL where the better-auth session cookie isn't readable) to
// a same-origin /connections/oauth-finalize page on BETTER_AUTH_URL where
// the current user's session IS readable. The callback exchanges the OAuth
// code, encrypts the resulting tokens + provider-specific payload into
// `payload`, and writes a row keyed by the JWT-claimed (user, org). The
// finalize page asserts `session.user.id === claimed_user_id` before
// committing the credentials — this is the defense against an attacker
// who replays their own state JWT against a victim's browser to land the
// victim's tokens under the attacker's org. Rows are short-lived (~2 min)
// and one-shot (consumed_at flips on the first successful finalize).
export const oauthPendingGrants = pgTable(
  'oauth_pending_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    claimedUserId: uuid('claimed_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    claimedOrganizationId: uuid('claimed_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    payload: encryptedText('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => ({
    expiresIdx: index('oauth_pending_grants_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.consumedAt} IS NULL`),
  }),
);
