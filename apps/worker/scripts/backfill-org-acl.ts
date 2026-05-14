/**
 * One-shot CLI: append `org:${organization_id}` to `acl_subjects` on every
 * existing `chunks` + `source_artifacts` row that's missing it.
 *
 *   pnpm --filter @holo/worker exec tsx --env-file=$PWD/.env scripts/backfill-org-acl.ts
 *
 * Why this exists: connectors that emit their own chunks (airtable, asana,
 * confluence, jira, linear) historically wrote only provider-scoped ACL
 * subjects (`airtable:base:X`, `confluence:org`, …). Those don't intersect
 * with the user-side subject set (`org:${orgId}`, `user:${id}`, …) that
 * the Files API + RAG retrieval use to filter rows. Result: those rows
 * were indexed but invisible to every Holo surface. The chunkers have
 * been fixed to include `org:${orgId}` going forward; this script
 * patches the rows that were ingested before the fix.
 *
 * Idempotent — appends only when the subject is missing.
 */
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const artifactRes = await sql<{ count: bigint }[]>`
      UPDATE source_artifacts
      SET acl_subjects = array_append(
        acl_subjects,
        'org:' || organization_id::text
      )
      WHERE NOT ('org:' || organization_id::text = ANY(acl_subjects))
      RETURNING 1
    `;
    console.log(`source_artifacts: appended org subject to ${artifactRes.count} rows`);

    const chunkRes = await sql<{ count: bigint }[]>`
      UPDATE chunks
      SET acl_subjects = array_append(
        acl_subjects,
        'org:' || organization_id::text
      )
      WHERE NOT ('org:' || organization_id::text = ANY(acl_subjects))
      RETURNING 1
    `;
    console.log(`chunks: appended org subject to ${chunkRes.count} rows`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
