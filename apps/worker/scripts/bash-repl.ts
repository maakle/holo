/**
 * Local REPL-ish runner for the agent `bash` tool. Bypasses the LLM so you
 * can verify the bash → HoloFs → DB path with a known script.
 *
 * IMPORTANT: invoke via the tsx binary directly — `pnpm --filter ... exec`
 * eats `-r` / `-l` style flags before they reach the script, so any
 * command with single-letter flags gets mangled. The full tsx path is:
 *
 *   TSX=node_modules/.pnpm/node_modules/.bin/tsx
 *   DATABASE_URL=... "$TSX" apps/worker/scripts/bash-repl.ts 'ls /'
 *   DATABASE_URL=... "$TSX" apps/worker/scripts/bash-repl.ts 'cat /sample/docs/doc-order-66-contingency.md'
 *   DATABASE_URL=... "$TSX" apps/worker/scripts/bash-repl.ts 'grep -rl Rebel /sample'
 *   DATABASE_URL=... "$TSX" apps/worker/scripts/bash-repl.ts 'ls /sample/docs | wc -l'
 *
 * Env:
 *   DATABASE_URL        Required.
 *   HOLO_ORG_ID         Optional. Defaults to the only org if there's one,
 *                       otherwise picks `name = 'Default'` if present, else
 *                       errors out and prints choices.
 *   HOLO_USER_SUBJECTS  Optional. Comma-separated extra subjects to add on
 *                       top of `org:<id>` (e.g. `user:abc,group:eng`).
 *                       Defaults to org-scope only — matches what a
 *                       workspace admin would see.
 */
import { createDb, schema, type DB } from '@holo/db';
import { asc } from 'drizzle-orm';
import { runBashTool } from '@holo/agent-tools';

async function resolveOrgId(db: DB): Promise<string> {
  const explicit = process.env.HOLO_ORG_ID;
  if (explicit) return explicit;
  const rows = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .orderBy(asc(schema.organization.createdAt));
  if (rows.length === 0) {
    console.error('No organizations found.');
    process.exit(1);
  }
  if (rows.length === 1) return rows[0]!.id;
  const def = rows.find((r) => r.name === 'Default');
  if (def) return def.id;
  console.error('Multiple orgs found. Set HOLO_ORG_ID to one of:');
  for (const r of rows) console.error(`  ${r.id}  ${r.name}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const script = process.argv.slice(2).join(' ').trim();
  if (!script) {
    console.error('Usage: tsx scripts/bash-repl.ts <bash-script>');
    console.error("Example: tsx scripts/bash-repl.ts 'ls /'");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const db = createDb(url);
  try {
    const orgId = await resolveOrgId(db);
    const extra = (process.env.HOLO_USER_SUBJECTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const userSubjects = [`org:${orgId}`, ...extra];

    const out = await runBashTool(
      { db, organizationId: orgId, userSubjects },
      { script },
    );

    if (out.stdout) {
      process.stdout.write(out.stdout);
      if (!out.stdout.endsWith('\n')) process.stdout.write('\n');
    }
    if (out.stderr) {
      process.stderr.write(`--- stderr ---\n${out.stderr}`);
      if (!out.stderr.endsWith('\n')) process.stderr.write('\n');
    }
    if (out.truncated) {
      console.error(`(truncated: ${Object.keys(out.truncated).join(', ')})`);
    }
    if (out.timed_out) console.error('(timed out)');
    process.exit(out.exit_code);
  } finally {
    // createDb returns a drizzle wrapper; the underlying postgres-js
    // client is on `.$client`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (db as any).$client ?? (db as any).client;
    if (client?.end) await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
