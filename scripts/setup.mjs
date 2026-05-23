#!/usr/bin/env node
// One-shot first-run setup for `git clone holo && pnpm install && pnpm bootstrap`.
// Idempotent: safe to re-run after a partial failure.
//   1. Verify docker + docker compose v2 are installed
//   2. Create .env from .env.example with random secrets (skip if .env exists)
//   3. Start infra (postgres + redis) via `docker compose up -d`
//   4. Run `pnpm db:migrate`
//   5. Print next steps
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');
const ENV_EXAMPLE_PATH = join(ROOT, '.env.example');

const c = {
  bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[1;31m', green: '\x1b[1;32m',
  yellow: '\x1b[1;33m', cyan: '\x1b[1;36m', reset: '\x1b[0m',
};
const step = (msg) => console.log(`${c.bold}→${c.reset} ${msg}`);
const ok = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}!${c.reset} ${msg}`);
const die = (msg) => { console.error(`${c.red}✗${c.reset} ${msg}`); process.exit(1); };

function has(cmd, args = ['--version']) {
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

function run(cmd, args, { cwd = ROOT } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) die(`\`${cmd} ${args.join(' ')}\` failed (exit ${r.status})`);
}

// --- 1. Prereqs ---
step('Checking prerequisites');
if (!has('docker')) die('docker not found. Install Docker Desktop: https://docs.docker.com/get-docker/');
if (!has('docker', ['compose', 'version'])) die('docker compose v2 is required.');
ok('docker + docker compose available');

// --- 2. .env ---
if (existsSync(ENV_PATH)) {
  ok('.env already exists (left untouched)');
} else {
  step('Generating .env from .env.example with random secrets');
  if (!existsSync(ENV_EXAMPLE_PATH)) die('.env.example missing — are you in the repo root?');
  let env = readFileSync(ENV_EXAMPLE_PATH, 'utf8');

  const pgPass = randomBytes(16).toString('hex');
  const tokenKey = randomBytes(32).toString('base64');
  const authSecret = randomBytes(32).toString('base64');

  env = env
    .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${pgPass}`)
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgresql://holo:${pgPass}@localhost:5436/holo`)
    .replace(/^HOLO_TOKEN_ENCRYPTION_KEY=.*$/m, `HOLO_TOKEN_ENCRYPTION_KEY=${tokenKey}`)
    .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${authSecret}`);

  writeFileSync(ENV_PATH, env, 'utf8');
  ok('.env created with generated secrets');
  warn('GITHUB_LOGIN_CLIENT_ID / GITHUB_LOGIN_CLIENT_SECRET still empty — sign-in will not work until you fill them.');
  console.log(`  ${c.dim}Create the OAuth app at https://github.com/settings/developers (callback: http://localhost:3000/api/auth/callback/github)${c.reset}`);
}

// --- 3. Infra ---
step('Starting postgres + redis (docker compose up -d)');
run('docker', ['compose', 'up', '-d']);

// --- 4. Migrate ---
step('Running database migrations (pnpm db:migrate)');
run('pnpm', ['db:migrate']);

// --- 5. Done ---
console.log('');
ok('Setup complete.');
console.log('');
console.log(`  ${c.bold}Next:${c.reset} ${c.cyan}pnpm dev${c.reset}`);
console.log(`         then open ${c.cyan}http://localhost:3000${c.reset}`);
console.log('');
console.log(`  ${c.dim}Stop infra:${c.reset}  docker compose down`);
console.log(`  ${c.dim}Reset DB:${c.reset}    docker compose down -v && pnpm bootstrap`);
