import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';
import { organization } from './auth';

/**
 * Idempotency log for transactional emails sent via `@holo/email`. Every
 * `sendIdempotent` call computes a stable `idempotency_key` (typically
 * something like `<kind>:<org_id>:<period_start>`) and inserts with
 * `ON CONFLICT (idempotency_key) DO NOTHING` — the second call no-ops.
 *
 * Why a table rather than memoising in the sender: workers restart, so an
 * in-memory cache loses state. A DB row survives restarts and replays. The
 * row is small (one per email actually sent), and the unique index handles
 * concurrent senders racing for the same key.
 *
 * `organization_id` is nullable so this same log can host non-org emails
 * (e.g. system-level alerts) later. `recipient_email` is captured for
 * audit/debugging even though the primary key is the idempotency string.
 */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    recipientEmail: text('recipient_email').notNull(),
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    orgKindSentIdx: index('email_log_org_kind_sent_idx').on(
      t.organizationId,
      t.kind,
      t.sentAt.desc(),
    ),
  }),
);
