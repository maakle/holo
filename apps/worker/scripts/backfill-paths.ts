/**
 * One-shot CLI: backfill the `path` + denormalized `acl_subjects` columns
 * on `source_artifacts` for rows ingested before migration 0047 (RFC 0009).
 *
 *   pnpm --filter @holo/worker exec tsx scripts/backfill-paths.ts
 *   pnpm --filter @holo/worker exec tsx scripts/backfill-paths.ts --repair
 *
 * Modes:
 *   default — fills `path IS NULL` rows.
 *   --repair — recomputes paths on existing rows and rewrites those whose
 *              current value disagrees with the path-fn. Use after a
 *              path-fn change leaves stale paths in place (e.g. the
 *              2026-05-14 Airtable/Confluence/Jira/Asana camelCase fix).
 *
 * Flags via env:
 *   HOLO_PATH_BACKFILL_BATCH_SIZE      (default 500)
 *   HOLO_PATH_BACKFILL_MAX_ARTIFACTS   (default unbounded)
 *   HOLO_PATH_BACKFILL_REPAIR          (1/true — same as --repair)
 *
 * Safe to run repeatedly: idempotent in both modes. Default mode skips
 * already-filled rows; repair mode skips rows whose recomputed path
 * matches the stored value.
 */
import postgres from 'postgres';
import { runPathBackfill } from '../src/queues/path-backfill';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const repair =
    process.argv.includes('--repair')
    || process.env.HOLO_PATH_BACKFILL_REPAIR === '1'
    || process.env.HOLO_PATH_BACKFILL_REPAIR === 'true';
  console.log(`mode: ${repair ? 'repair (recompute non-NULL paths)' : 'fill (NULL paths only)'}`);
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const result = await runPathBackfill(sql, {
      batchSize: Number(process.env.HOLO_PATH_BACKFILL_BATCH_SIZE) || 500,
      maxArtifacts: process.env.HOLO_PATH_BACKFILL_MAX_ARTIFACTS
        ? Number(process.env.HOLO_PATH_BACKFILL_MAX_ARTIFACTS)
        : undefined,
      repair,
      onBatch: (s) =>
        console.log(
          `  scanned=${s.scanned} ${repair ? 'rewrote' : 'filled'}=${s.filled} `
            + (repair ? `unchanged=${s.unchanged} ` : '')
            + `skipped(unknown-kind)=${s.skippedUnknownKind} `
            + `skipped(bad-metadata)=${s.skippedBadMetadata}`,
        ),
    });
    console.log('\ndone:');
    console.log(`  totalScanned=${result.totalScanned}`);
    console.log(`  total${repair ? 'Rewrote' : 'Filled'}=${result.totalFilled}`);
    if (repair) console.log(`  totalUnchanged=${result.totalUnchanged}`);
    console.log(`  totalSkippedUnknownKind=${result.totalSkippedUnknownKind}`);
    console.log(`  totalSkippedBadMetadata=${result.totalSkippedBadMetadata}`);
    if (Object.keys(result.filledByKind).length > 0) {
      console.log(`\n${repair ? 'Rewritten' : 'Filled'} by kind:`);
      for (const [k, n] of Object.entries(result.filledByKind).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`  ${k}  ${n}`);
      }
    }
    if (Object.keys(result.unknownKinds).length > 0) {
      console.log(
        `\nKinds with no registered path-fn (${repair ? 'left as-is' : 'rows still NULL'}):`,
      );
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
