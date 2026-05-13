/**
 * One-shot CLI: walk `chunks` and stamp `account_id` from metadata hints.
 *
 *   pnpm --filter @holo/worker exec tsx scripts/backfill-customer-accounts.ts
 *
 * Flags via env:
 *   HOLO_BACKFILL_BATCH_SIZE          (default 500)
 *   HOLO_BACKFILL_MAX_CHUNKS          (default unbounded)
 *   HOLO_BACKFILL_INCLUDE_STAMPED=1   re-resolve rows that already have an
 *                                     account_id (after a merge or alias edit)
 *
 * Safe to run repeatedly: idempotent per the resolver's contract.
 */
import postgres from 'postgres';
import { runAccountBackfill } from '../src/queues/account-backfill';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const result = await runAccountBackfill(sql, {
      batchSize: Number(process.env.HOLO_BACKFILL_BATCH_SIZE) || 500,
      maxChunks: process.env.HOLO_BACKFILL_MAX_CHUNKS
        ? Number(process.env.HOLO_BACKFILL_MAX_CHUNKS)
        : undefined,
      includeAlreadyStamped: process.env.HOLO_BACKFILL_INCLUDE_STAMPED === '1',
      onBatch: (s) =>
        console.log(
          `  scanned=${s.scanned} stamped=${s.stamped} cleaned=${s.metadataCleaned}`,
        ),
    });
    console.log(
      `done: scanned=${result.totalScanned} `
        + `stamped=${result.totalStamped} `
        + `metadataCleaned=${result.totalMetadataCleaned}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
