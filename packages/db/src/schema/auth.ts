import { pgTable, text, timestamp, boolean, jsonb, uuid, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { encryptedText } from './encrypted-text';

// organization MUST be defined first because user.organization_id references it.
export const organization = pgTable('organization', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  // The user's "home" organization — populated at signup with a personal
  // org owned by the user (see databaseHooks.user.create.after in
  // packages/auth/src/server.ts). NOT the shared "default" org; that one is
  // demo-only and joinable solely by explicit invitation. Multi-tenancy:
  // a user can belong to additional orgs via `member`; active org per
  // session is tracked on `session.activeOrganizationId`.
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organization.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  // Set by Better Auth's organization plugin when the user switches orgs.
  // Null means "use the user's home org (user.organization_id)."
  activeOrganizationId: uuid('active_organization_id').references(
    () => organization.id,
    { onDelete: 'set null' },
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  accessToken: encryptedText('access_token'),
  refreshToken: encryptedText('refresh_token'),
  idToken: text('id_token'),
  scope: text('scope'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Better Auth `organization` plugin: a user can be a member of N orgs.
// `role` is plugin-defined (default values: owner / admin / member).
export const member = pgTable(
  'member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUserUniq: uniqueIndex('member_org_user_uniq').on(t.organizationId, t.userId),
    userIdx: index('member_user_idx').on(t.userId),
  }),
);

// Holo-native shareable invite link. Exactly one row per organization (PK on
// organization_id). Anyone signed in who hits /join/<token> joins as 'member'.
// Regenerate = UPDATE token (old token instantly invalid). Revoke = DELETE.
export const orgInviteLink = pgTable('org_invite_link', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Better Auth `organization` plugin: pending email invitations to join an org.
export const invitation = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'canceled'] })
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgEmailIdx: index('invitation_org_email_idx').on(t.organizationId, t.email),
    statusIdx: index('invitation_status_idx').on(t.status, t.expiresAt),
  }),
);
