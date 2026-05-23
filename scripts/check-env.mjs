#!/usr/bin/env node
// Pre-flight env validator. Runs before `pnpm dev` to fail fast with a
// human-readable message instead of letting each app crash mid-boot.
//
// REQUIRED list mirrors the boot-required fields in packages/env/src/index.ts.
// If you add a new required env var, update both this file and the schema.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');

const REQUIRED = [
  { key: 'DATABASE_URL', hint: 'set to postgresql://holo:<password>@localhost:5436/holo' },
  { key: 'REDIS_URL', hint: 'set to redis://localhost:6382' },
  { key: 'HOLO_TOKEN_ENCRYPTION_KEY', hint: 'generate with: openssl rand -base64 32' },
  { key: 'BETTER_AUTH_SECRET', hint: 'generate with: openssl rand -base64 32' },
  { key: 'BETTER_AUTH_URL', hint: 'set to http://localhost:3000 for local dev' },
  { key: 'GITHUB_LOGIN_CLIENT_ID', hint: 'create OAuth app: https://github.com/settings/developers' },
  { key: 'GITHUB_LOGIN_CLIENT_SECRET', hint: 'paste the client secret from the same OAuth app' },
];

const c = { red: '\x1b[1;31m', yellow: '\x1b[1;33m', dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m' };

function die(msg) { console.error(msg); process.exit(1); }

if (!existsSync(ENV_PATH)) {
  die(`${c.red}✗ .env not found${c.reset}\n  Run ${c.bold}pnpm bootstrap${c.reset} to create one.`);
}

// Minimal .env parser: KEY=VALUE per line, # comments, no quoting magic.
// Good enough for a pre-flight; the apps use proper dotenv at runtime.
const env = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/i);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const PLACEHOLDERS = new Set(['', '<REPLACE_ME>', 'CHANGE_ME', 'changeme']);
const missing = REQUIRED.filter(({ key }) => PLACEHOLDERS.has(env[key] ?? ''));

if (missing.length === 0) process.exit(0);

console.error(`${c.red}✗ ${missing.length} required env var${missing.length === 1 ? '' : 's'} missing in .env${c.reset}`);
console.error('');
for (const { key, hint } of missing) {
  console.error(`  ${c.bold}${key}${c.reset}`);
  console.error(`    ${c.dim}${hint}${c.reset}`);
}
console.error('');
console.error(`${c.yellow}!${c.reset} Edit ${c.bold}.env${c.reset} and re-run ${c.bold}pnpm dev${c.reset}, or run ${c.bold}pnpm bootstrap${c.reset} to start fresh.`);
process.exit(1);
