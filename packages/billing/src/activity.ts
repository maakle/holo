import { desc, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

const { creditLedger } = schema;

export interface LedgerActivityRow {
  id: string;
  kind: 'grant' | 'debit' | 'refund' | 'expiry' | 'topup' | 'adjustment';
  credits: number;
  reason: string;
  referenceKind: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Recent ledger entries for the activity table on /settings/billing. */
export async function recentLedgerActivity(
  db: DB,
  organizationId: string,
  limit = 50,
): Promise<LedgerActivityRow[]> {
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, organizationId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    credits: Number(row.credits),
    reason: row.reason,
    referenceKind: row.referenceKind,
    referenceId: row.referenceId,
    metadata: row.metadata,
    createdAt: row.createdAt,
  }));
}
