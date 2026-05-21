import type { ReactElement } from 'react';
import { render } from '@react-email/render';
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { sendViaResend } from './transport';

const { emailLog } = schema;

export interface SendEmailArgs {
  to: string;
  subject: string;
  /** React Email JSX. Renders to HTML via `@react-email/render`; the plain-
   *  text fallback is auto-extracted from the same JSX. */
  react: ReactElement;
  /** Tag used in logs / Posthog. `'storage_cap_reached'`, `'invitation'`, etc. */
  kind: string;
}

/**
 * Fire-and-forget transactional email. Renders the React Email JSX to both
 * HTML and plain text, then ships it via Resend (or logs to stdout when
 * EMAIL_PROVIDER=console).
 *
 * No idempotency at this layer — call `sendIdempotent` for that.
 */
export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const [html, text] = await Promise.all([
    render(args.react),
    render(args.react, { plainText: true }),
  ]);
  await sendViaResend({
    to: args.to,
    subject: args.subject,
    html,
    text,
    tag: args.kind,
  });
}

export interface SendIdempotentArgs extends SendEmailArgs {
  /** Stable key — typically `<kind>:<org_id>:<period_or_event_id>`. A second
   *  call with the same key is a no-op. */
  idempotencyKey: string;
  /** Optional org reference for the audit log + future per-org queries. */
  organizationId?: string | null;
  /** Optional metadata persisted alongside the audit row. */
  metadata?: Record<string, unknown>;
}

/**
 * Send-once email. Inserts an `email_log` row first; the unique constraint
 * on `idempotency_key` collapses concurrent senders to a single delivery.
 * Only sends if the insert actually wrote a row (i.e. it wasn't a duplicate).
 *
 * Returns `true` when an email was sent, `false` on a no-op (already sent).
 *
 * Failure modes:
 *   - DB insert fails → throws (caller decides whether to log + ignore or retry)
 *   - Insert succeeds but the Resend call fails → the row exists but no email
 *     went out. We rethrow so the caller can decide (retry would have to
 *     delete + re-insert; usually best to alert and move on).
 */
export async function sendIdempotent(
  db: DB,
  args: SendIdempotentArgs,
): Promise<boolean> {
  const inserted = await db
    .insert(emailLog)
    .values({
      organizationId: args.organizationId ?? null,
      recipientEmail: args.to,
      kind: args.kind,
      subject: args.subject,
      idempotencyKey: args.idempotencyKey,
      metadata: args.metadata,
    })
    .onConflictDoNothing({ target: emailLog.idempotencyKey })
    .returning({ id: emailLog.id });
  if (inserted.length === 0) return false;

  try {
    await sendEmail(args);
    return true;
  } catch (err) {
    // Resend rejected. Drop the log row so a future call can retry — keeping
    // the row would silently swallow the retry via the conflict guard.
    await db.delete(emailLog).where(eq(emailLog.id, inserted[0]!.id));
    throw err;
  }
}
