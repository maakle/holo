/**
 * One-shot CLI: backfill the `path` + denormalized `acl_subjects` columns
 * on `source_artifacts` for rows ingested before migration 0047 (RFC 0009).
 *
 *   pnpm --filter @holo/worker exec tsx scripts/backfill-paths.ts
 *
 * Flags via env:
 *   HOLO_PATH_BACKFILL_BATCH_SIZE      (default 500)
 *   HOLO_PATH_BACKFILL_MAX_ARTIFACTS   (default unbounded)
 *
 * Safe to run repeatedly: idempotent. Rows with no registered path-fn
 * stay NULL and are reported in the summary so the operator can add a
 * path-fn before re-running.
 */
import postgres from 'postgres';
import { runPathBackfill } from '../src/queues/path-backfill';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const result = await runPathBackfill(sql, {
      batchSize: Number(process.env.HOLO_PATH_BACKFILL_BATCH_SIZE) || 500,
      maxArtifacts: process.env.HOLO_PATH_BACKFILL_MAX_ARTIFACTS
        ? Number(process.env.HOLO_PATH_BACKFILL_MAX_ARTIFACTS)
        : undefined,
      onBatch: (s) =>
        console.log(
          `  scanned=${s.scanned} filled=${s.filled} `
            + `skipped(unknown-kind)=${s.skippedUnknownKind} `
            + `skipped(bad-metadata)=${s.skippedBadMetadata}`,
        ),
    });
    console.log('\ndone:');
    console.log(`  totalScanned=${result.totalScanned}`);
    console.log(`  totalFilled=${result.totalFilled}`);
    console.log(`  totalSkippedUnknownKind=${result.totalSkippedUnknownKind}`);
    console.log(`  totalSkippedBadMetadata=${result.totalSkippedBadMetadata}`);
    if (Object.keys(result.unknownKinds).length > 0) {
      console.log('\nKinds with no registered path-fn (rows still NULL):');
      for (const [k, n] of Object.entries(result.unknownKinds).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`  ${k}  ${n}`);
      }
      console.log(
        '\nAdd entries to packages/chunker/src/path-fn.ts and re-run.',
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
