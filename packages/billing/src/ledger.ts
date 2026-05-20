import { sql, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import { billingEnabled } from './env';
import { deriveIdempotencyKey } from './idempotency';
import {
  computeLlmCreditsForUsage,
  computeSyncCreditsForRun,
} from './pricing';
import type { LLMUsage } from '@holo/llm';

const { creditLedger } = schema;

export type LedgerKind = 'grant' | 'debit' | 'refund' | 'expiry' | 'topup' | 'adjustment';
export type LedgerReason =
  | 'monthly_grant'
  | 'llm_call'
  | 'connector_sync'
  | 'topup_purchase'
  | 'manual'
  | 'plan_change'
  | 'expiry';

export type LedgerReferenceKind =
  | 'agent_loop'
  | 'sync_run'
  | 'subscription'
  | 'stripe_invoice'
  | 'stripe_checkout'
  | 'manual';

export interface WriteLedgerEntry {
  organizationId: string;
  kind: LedgerKind;
  /** Positive for grants/topups/refunds, negative for debits/expiries. */
  credits: number;
  reason: LedgerReason;
  referenceKind: LedgerReferenceKind;
  referenceId: string;
  /** Optional: pass when you've already derived it (e.g. tests). Otherwise
   *  the function derives `sha1(referenceKind:referenceId)` automatically. */
  idempotencyKey?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Append a row to credit_ledger. Idempotent via the unique constraint on
 * idempotency_key. Returns:
 *   - 'written' when a new row was inserted
 *   - 'duplicate' when the (kind:id) pair was already recorded
 *   - 'disabled' when HOLO_BILLING_ENABLED is off
 *
 * Never throws on duplicates; caller can safely retry on transient errors.
 */
export async function writeLedgerEntry(
  db: DB,
  entry: WriteLedgerEntry,
): Promise<'written' | 'duplicate' | 'disabled'> {
  if (!billingEnabled()) return 'disabled';
  const idempotencyKey =
    entry.idempotencyKey ?? deriveIdempotencyKey(entry.referenceKind, entry.referenceId);
  const result = await db
    .insert(creditLedger)
    .values({
      organizationId: entry.organizationId,
      kind: entry.kind,
      credits: entry.credits,
      reason: entry.reason,
      referenceKind: entry.referenceKind,
      referenceId: entry.referenceId,
      idempotencyKey,
      expiresAt: entry.expiresAt ?? null,
      metadata: entry.metadata ?? null,
    })
    .onConflictDoNothing({ target: creditLedger.idempotencyKey })
    .returning({ id: creditLedger.id });
  return result.length > 0 ? 'written' : 'duplicate';
}

/**
 * High-level helper called from the agent surfaces (web chat, Slack bot,
 * Google Chat bot) after each LLM call returns usage data. Computes the
 * credit cost from the price book and writes a `debit` row.
 *
 * `referenceId` should be unique per LLM call within the org — the agent
 * surfaces use `${turnId}:${modelCall}` to dedupe streaming retries.
 */
export async function debitLlmUsage(args: {
  db: DB;
  organizationId: string;
  model: string;
  usage: LLMUsage;
  referenceId: string;
  metadata?: Record<string, unknown>;
}): Promise<'written' | 'duplicate' | 'disabled' | 'no_charge'> {
  if (!billingEnabled()) return 'disabled';
  const { total, breakdown } = await computeLlmCreditsForUsage({
    db: args.db,
    model: args.model,
    usage: args.usage,
  });
  if (total <= 0) return 'no_charge';
  return writeLedgerEntry(args.db, {
    organizationId: args.organizationId,
    kind: 'debit',
    credits: -total,
    reason: 'llm_call',
    referenceKind: 'agent_loop',
    referenceId: args.referenceId,
    metadata: {
      model: args.model,
      usage: args.usage,
      breakdown,
      ...(args.metadata ?? {}),
    },
  });
}

/**
 * High-level helper called from sync-processor-base after a sync run
 * finishes OK. Computes the credit cost from the per-provider sync_artifact
 * rate and writes a `debit` row.
 */
export async function debitConnectorSync(args: {
  db: DB;
  organizationId: string;
  provider: string;
  artifactCount: number;
  syncRunReference: string;
  breakdown?: Record<string, { new: number; deduped: number }> | null;
}): Promise<'written' | 'duplicate' | 'disabled' | 'no_charge'> {
  if (!billingEnabled()) return 'disabled';
  if (args.artifactCount <= 0) return 'no_charge';
  const credits = await computeSyncCreditsForRun({
    db: args.db,
    provider: args.provider,
    artifactCount: args.artifactCount,
  });
  if (credits <= 0) return 'no_charge';
  return writeLedgerEntry(args.db, {
    organizationId: args.organizationId,
    kind: 'debit',
    credits: -credits,
    reason: 'connector_sync',
    referenceKind: 'sync_run',
    referenceId: args.syncRunReference,
    metadata: {
      provider: args.provider,
      artifactCount: args.artifactCount,
      ...(args.breakdown ? { breakdown: args.breakdown } : {}),
    },
  });
}

export interface OrgBalance {
  balance: number;
  debitsTotal: number;
  grantsTotal: number;
}

/**
 * Read the current credit balance for an org from the org_credit_balance
 * view (a fold over credit_ledger). Returns zeros if the view has no row
 * (i.e. the org has never had a ledger entry — shouldn't happen after
 * migration backfill, but the fallback keeps callers from crashing).
 */
export async function getOrgBalance(db: DB, organizationId: string): Promise<OrgBalance> {
  const rows = await db.execute<{
    balance: string | number;
    debits_total: string | number;
    grants_total: string | number;
  }>(
    sql`SELECT balance, debits_total, grants_total
        FROM org_credit_balance
        WHERE organization_id = ${organizationId}`,
  );
  const row = (rows as { rows?: unknown[] }).rows?.[0] ?? (rows as unknown[])[0];
  if (!row) return { balance: 0, debitsTotal: 0, grantsTotal: 0 };
  const r = row as Record<string, unknown>;
  return {
    balance: Number(r.balance ?? 0),
    debitsTotal: Number(r.debits_total ?? 0),
    grantsTotal: Number(r.grants_total ?? 0),
  };
}

/** Sum of debits inside the current billing period, for the "this month
 * used" widget. The period is derived from organization_subscriptions. */
export async function getCurrentPeriodUsage(
  db: DB,
  organizationId: string,
): Promise<{ llmCredits: number; syncCredits: number; total: number }> {
  const sub = await db
    .select({
      start: schema.organizationSubscriptions.currentPeriodStart,
    })
    .from(schema.organizationSubscriptions)
    .where(eq(schema.organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  const periodStart = sub[0]?.start ?? new Date(0);

  const rows = await db.execute<{ reason: string; total: string | number }>(
    sql`SELECT reason, SUM(-credits) AS total
        FROM credit_ledger
        WHERE organization_id = ${organizationId}
          AND kind = 'debit'
          AND created_at >= ${periodStart.toISOString()}
        GROUP BY reason`,
  );
  const list = (rows as { rows?: unknown[] }).rows ?? (rows as unknown[]);
  let llm = 0;
  let sync = 0;
  for (const r of list as Array<Record<string, unknown>>) {
    const n = Number(r.total ?? 0);
    if (r.reason === 'llm_call') llm += n;
    else if (r.reason === 'connector_sync') sync += n;
  }
  return { llmCredits: llm, syncCredits: sync, total: llm + sync };
}
