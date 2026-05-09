/**
 * CI guardrail for Drizzle migration meta. Catches the failure modes that
 * historically wrecked migrations/ on this repo:
 *
 *   - _journal.json idx not contiguous from 0
 *   - _journal.json `when` timestamps non-monotonic (apply order surprises)
 *   - journal entries with no matching .sql file (or vice versa)
 *   - missing snapshot for the latest journal entry
 *     (drizzle-kit generate silently produces wrong diffs without it)
 *
 * Run via `pnpm db:check` or directly: `tsx scripts/check-migrations.ts`.
 * Exits non-zero on any violation. Add new invariants here, not in CI YAML.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

const errors: string[] = [];
const warnings: string[] = [];

function fail(msg: string): void {
  errors.push(msg);
}
function warn(msg: string): void {
  warnings.push(msg);
}

if (!existsSync(JOURNAL_PATH)) {
  fail(`missing ${JOURNAL_PATH}`);
  report();
  process.exit(1);
}

const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal;

// Invariant 1: idx must be contiguous from 0.
const sortedByIdx = [...journal.entries].sort((a, b) => a.idx - b.idx);
sortedByIdx.forEach((entry, i) => {
  if (entry.idx !== i) {
    fail(
      `journal idx is not contiguous: expected ${i} at position ${i}, got ${entry.idx} (tag ${entry.tag})`,
    );
  }
});

// Invariant 2: `when` must be monotonically increasing with idx.
for (let i = 1; i < sortedByIdx.length; i++) {
  const prev = sortedByIdx[i - 1]!;
  const curr = sortedByIdx[i]!;
  if (curr.when <= prev.when) {
    fail(
      `journal when timestamp not monotonic: idx ${prev.idx} (${prev.tag}) when=${prev.when} >= idx ${curr.idx} (${curr.tag}) when=${curr.when}`,
    );
  }
}

// Invariant 3: every journal tag has a matching .sql file.
const sqlFiles = new Set(
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, '')),
);
for (const entry of journal.entries) {
  if (!sqlFiles.has(entry.tag)) {
    fail(`journal entry idx ${entry.idx} tag '${entry.tag}' has no matching ${entry.tag}.sql`);
  }
}

// Invariant 4: every .sql file has a journal entry.
const journalTags = new Set(journal.entries.map((e) => e.tag));
for (const tag of sqlFiles) {
  if (!journalTags.has(tag)) {
    fail(`migration ${tag}.sql has no entry in _journal.json — drizzle-kit migrate will skip it`);
  }
}

// Invariant 5: the LATEST journal entry must have a corresponding snapshot.
// drizzle-kit generate uses meta/<idx>_snapshot.json (idx-padded to 4 digits)
// as the previous-state reference; if it's stale the next migration's diff
// is wrong.
const latest = sortedByIdx[sortedByIdx.length - 1];
if (latest) {
  const padded = String(latest.idx).padStart(4, '0');
  const snapshotPath = path.join(META_DIR, `${padded}_snapshot.json`);
  if (!existsSync(snapshotPath)) {
    fail(
      `latest journal entry idx ${latest.idx} (${latest.tag}) has no snapshot at meta/${padded}_snapshot.json — \`pnpm db:generate\` will produce a wrong diff`,
    );
  }
}

// Invariant 6 (warning): filenames should have monotonically increasing
// numeric prefixes matching idx. Suffixes like `0011b` and gaps like jumping
// from 0012 → 0014 happen when two PRs grab the same number; tolerable but
// worth flagging.
sortedByIdx.forEach((entry) => {
  const expectedPrefix = String(entry.idx).padStart(4, '0');
  const actualPrefix = entry.tag.slice(0, expectedPrefix.length);
  if (actualPrefix !== expectedPrefix) {
    warn(
      `journal idx ${entry.idx} tag '${entry.tag}' does not have prefix '${expectedPrefix}' — likely a parallel-PR numbering collision`,
    );
  }
});

function report(): void {
  for (const w of warnings) {
    console.warn(`warning: ${w}`);
  }
  for (const e of errors) {
    console.error(`error: ${e}`);
  }
}

report();

if (errors.length > 0) {
  console.error(`\n${errors.length} migration meta error(s) — see CONTRIBUTING.md § "Adding a connector / migration".`);
  process.exit(1);
}

console.log(
  `migration meta ok: ${journal.entries.length} entries, ${warnings.length} warning(s)`,
);
