/**
 * Customer-account backfill for chunks already in the DB.
 *
 * Chunks ingested before migration 0039 have `account_id = NULL`. New chunks
 * get stamped at insert time by embed-insert; this function walks the legacy
 * rows in batches, re-runs the same resolver against each chunk's metadata,
 * and UPDATEs the rows where a non-null id was resolved.
 *
 * Idempotent: rows whose hint resolves to NULL stay NULL and aren't seen
 * again by future runs that filter on `account_id IS NULL` (they will be
 * — fine, the resolver no-ops cheaply for hint-less rows). To force a
 * re-run after upserting more customer_accounts data, pass
 * `includeAlreadyStamped: true`.
 *
 * Operators trigger this via `apps/worker/scripts/backfill-customer-accounts.ts`
 * (one-shot CLI). Not a BullMQ job: this is migration-grade work, not
 * recurring ingest.
 */
import {
  CUSTOMER_ACCOUNT_HINT_KEY,
  CUSTOMER_ACCOUNT_UPSERT_KEY,
  resolveCustomerAccountsForBatch,
  stripCustomerAccountHints,
} from '@holo/connectors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

export interface AccountBackfillOptions {
  /** Max chunks per pass. Default 500. */
  batchSize?: number;
  /**
   * Re-resolve chunks that already have an `account_id`. Useful after a
   * customer_accounts merge or alias-table edit. Default false.
   */
  includeAlreadyStamped?: boolean;
  /** Stop after this many chunks total (across batches). Default unbounded. */
  maxChunks?: number;
  /** Per-batch logger hook. Default no-op. */
  onBatch?: (stats: AccountBackfillBatchStats) => void;
}

export interface AccountBackfillBatchStats {
  /** Cumulative chunks examined so far. */
  scanned: number;
  /** Cumulative chunks whose account_id was set/updated this run. */
  stamped: number;
  /** Cumulative chunks whose metadata had hints that we stripped. */
  metadataCleaned: number;
}

export interface AccountBackfillResult {
  totalScanned: number;
  totalStamped: number;
  totalMetadataCleaned: number;
}

interface ChunkRow {
  id: string;
  organization_id: string;
  metadata: Record<string, unknown> | null;
}

export async function runAccountBackfill(
  sql: Sql,
  opts: AccountBackfillOptions = {},
): Promise<AccountBackfillResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxChunks = opts.maxChunks ?? Number.POSITIVE_INFINITY;

  let totalScanned = 0;
  let totalStamped = 0;
  let totalMetadataCleaned = 0;
  let lastSeenId: string | null = null;

  while (totalScanned < maxChunks) {
    const limit = Math.min(batchSize, maxChunks - totalScanned);
    const rows = await selectBatch(sql, {
      includeAlreadyStamped: opts.includeAlreadyStamped ?? false,
      lastSeenId,
      limit,
    });
    if (rows.length === 0) break;

    const resolutions = await resolveCustomerAccountsForBatch(
      sql,
      rows.map((r) => ({ organizationId: r.organization_id, metadata: r.metadata })),
    );

    // Build update payload — only touch rows where SOMETHING changed
    // (account_id flipped OR metadata had hint keys to strip). This keeps
    // re-runs cheap.
    const updates: { id: string; accountId: string | null; metadata: Record<string, unknown> }[] = [];
    rows.forEach((row, i) => {
      const accountId = resolutions[i]?.accountId ?? null;
      const hadHints =
        !!row.metadata
        && typeof row.metadata === 'object'
        && (CUSTOMER_ACCOUNT_UPSERT_KEY in row.metadata
          || CUSTOMER_ACCOUNT_HINT_KEY in row.metadata);
      if (accountId !== null || hadHints) {
        const cleaned = stripCustomerAccountHints(row.metadata);
        updates.push({ id: row.id, accountId, metadata: cleaned });
        if (accountId !== null) totalStamped += 1;
        if (hadHints) totalMetadataCleaned += 1;
      }
    });
    if (updates.length > 0) {
      await applyUpdates(sql, updates);
    }

    totalScanned += rows.length;
    lastSeenId = rows[rows.length - 1]?.id ?? null;
    opts.onBatch?.({
      scanned: totalScanned,
      stamped: totalStamped,
      metadataCleaned: totalMetadataCleaned,
    });
    if (rows.length < limit) break;
  }

  return { totalScanned, totalStamped, totalMetadataCleaned };
}

async function selectBatch(
  sql: Sql,
  { includeAlreadyStamped, lastSeenId, limit }: {
    includeAlreadyStamped: boolean;
    lastSeenId: string | null;
    limit: number;
  },
): Promise<ChunkRow[]> {
  // id-keyset pagination: deterministic, no offset blow-up.
  if (includeAlreadyStamped) {
    return await sql<ChunkRow[]>`
      SELECT id, organization_id, metadata
      FROM chunks
      WHERE (${lastSeenId}::uuid IS NULL OR id > ${lastSeenId}::uuid)
      ORDER BY id
      LIMIT ${limit}
    `;
  }
  return await sql<ChunkRow[]>`
    SELECT id, organization_id, metadata
    FROM chunks
    WHERE account_id IS NULL
      AND (${lastSeenId}::uuid IS NULL OR id > ${lastSeenId}::uuid)
    ORDER BY id
    LIMIT ${limit}
  `;
}

async function applyUpdates(
  sql: Sql,
  updates: ReadonlyArray<{ id: string; accountId: string | null; metadata: Record<string, unknown> }>,
): Promise<void> {
  // One UPDATE per row would be N round-trips. UNNEST of parallel arrays is
  // one round-trip per batch — Postgres reads the three arrays into a virtual
  // table and joins it against chunks.id. NULL entries in the account_id
  // array survive the cast because the CASE skips the ::uuid coercion.
  const ids = updates.map((u) => u.id);
  const accountIds = updates.map((u) => u.accountId);
  const metadatas = updates.map((u) => JSON.stringify(u.metadata));
  await sql`
    UPDATE chunks AS c
    SET account_id = CASE WHEN u.account_id IS NULL THEN NULL ELSE u.account_id::uuid END,
        metadata = u.metadata::jsonb,
        updated_at = NOW()
    FROM UNNEST(
      ${ids}::text[],
      ${accountIds}::text[],
      ${metadatas}::text[]
    ) AS u(id, account_id, metadata)
    WHERE c.id = u.id::uuid
  `;
}
