/**
 * Scaffold a hand-authored data migration with all the meta pieces drizzle-kit
 * doesn't generate for us. Use this for any change drizzle-kit can't see — JSONB
 * sub-key renames, backfills, data corrections, CREATE INDEX CONCURRENTLY, RLS
 * policies, view/function bodies. For structural schema diffs, edit
 * `src/schema/*.ts` and run `pnpm generate` instead.
 *
 * Creates, atomically:
 *   - migrations/<NNNN>_<name>.sql        (stub with a TODO header)
 *   - migrations/meta/_journal.json       (new entry appended)
 *   - migrations/meta/<idx>_snapshot.json (copy of the previous snapshot)
 *
 * The numbering mirrors how drizzle-kit auto-generates: idx is contiguous from
 * 0, the filename tag is `(idx + 1)` padded to 4 digits, and the snapshot
 * filename uses idx (not the tag) padded to 4 digits. Yes, the +1 is confusing
 * — it's drizzle's convention, not ours; check-migrations.ts warns about it on
 * every entry, that's noise.
 *
 * Usage:
 *   pnpm db:new-data-migration <slug>
 *   pnpm db:new-data-migration rename_chunks_to_blocks
 */
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const META_DIR = path.join(MIGRATIONS_DIR, 'meta');
const JOURNAL_PATH = path.join(META_DIR, '_journal.json');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  version: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const rawSlug = process.argv[2];
if (!rawSlug) {
  die('usage: pnpm db:new-data-migration <slug>\n  e.g. pnpm db:new-data-migration rename_chunks_to_blocks');
}
if (!/^[a-z][a-z0-9_]{2,60}$/.test(rawSlug)) {
  die(`slug '${rawSlug}' must be snake_case, start with a letter, 3-60 chars: [a-z][a-z0-9_]{2,60}`);
}

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal;
const sortedByIdx = [...journal.entries].sort((a, b) => a.idx - b.idx);
const lastEntry = sortedByIdx[sortedByIdx.length - 1];
if (!lastEntry) die('journal has no entries — bootstrap a migration via drizzle-kit first');

const newIdx = lastEntry.idx + 1;
// Match drizzle-kit's convention: tag prefix = (idx + 1) padded. The next
// filename slot may already be taken if a parallel PR grabbed it during the
// rebase window — find the lowest available number ≥ (idx + 1).
const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
const usedNumbers = new Set(
  sqlFiles
    .map((f) => Number(f.slice(0, 4)))
    .filter((n) => Number.isInteger(n)),
);
let tagNumber = newIdx + 1;
while (usedNumbers.has(tagNumber)) tagNumber++;
const tag = `${String(tagNumber).padStart(4, '0')}_${rawSlug}`;
const sqlPath = path.join(MIGRATIONS_DIR, `${tag}.sql`);

// Bump `when` past the previous entry. Drizzle uses real epoch ms; we use
// `lastEntry.when + 1 day` so the value is deterministic + monotonic regardless
// of when the script runs.
const newWhen = lastEntry.when + 86_400_000;

// Snapshot filename is idx-padded (not tag-padded). For pure data migrations
// the snapshot is byte-identical to the previous one — copying is correct.
// For migrations that also touch schema, edit the snapshot or re-run
// `pnpm generate` afterwards to refresh it.
const prevSnapshotPath = path.join(META_DIR, `${String(lastEntry.idx).padStart(4, '0')}_snapshot.json`);
const newSnapshotPath = path.join(META_DIR, `${String(newIdx).padStart(4, '0')}_snapshot.json`);

const stubSql = `-- ${tag}
--
-- TODO: describe what this migration does and why.
-- Data migration scaffolded by \`pnpm db:new-data-migration\`. If the change
-- is structural (new column, new index, etc.), delete this and use
-- \`pnpm generate\` instead so drizzle-kit owns the diff.

`;

writeFileSync(sqlPath, stubSql, { flag: 'wx' });

const newEntry: JournalEntry = {
  idx: newIdx,
  version: lastEntry.version,
  when: newWhen,
  tag,
  breakpoints: true,
};
journal.entries.push(newEntry);
writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`);

copyFileSync(prevSnapshotPath, newSnapshotPath);

console.log(`created data migration:`);
console.log(`  sql:      migrations/${path.basename(sqlPath)}`);
console.log(`  journal:  meta/_journal.json (idx ${newIdx})`);
console.log(`  snapshot: meta/${path.basename(newSnapshotPath)} (copied from ${path.basename(prevSnapshotPath)})`);
console.log(`\nnext:`);
console.log(`  1. write the SQL in migrations/${path.basename(sqlPath)}`);
console.log(`  2. update any affected TypeScript in src/schema/`);
console.log(`  3. pnpm db:check && pnpm db:migrate`);
