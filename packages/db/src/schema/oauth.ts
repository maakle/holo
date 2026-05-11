import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user, organization } from './auth';

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Nullable: dynamic client registration (RFC 7591) is unauthenticated, so
    // the org binding only exists once a user authorizes a grant — see
    // oauth_auth_codes / oauth_access_tokens.
    organizationId: uuid('organization_id').references(() => organization.id),
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
    tokenPrefix: text('token_prefix'),
    label: text('label').notNull().default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    orgUserIdx: index('api_tokens_org_user_idx').on(t.organizationId, t.userId),
  }),
);
