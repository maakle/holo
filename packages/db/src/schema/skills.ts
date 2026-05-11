import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user, organization } from './auth';
import { sourceArtifacts } from './connectors';

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
