import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as readline from 'node:readline';
import { DOCKER_COMPOSE_TEMPLATE, TELEMETRY_PRIVACY_NOTICE } from './init-templates';

function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (result.length >= length) break;
      if (byte < chars.length * Math.floor(256 / chars.length)) {
        result += chars[byte % chars.length];
      }
    }
  }
  return result;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function isCommandAvailable(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isDockerComposeAvailable(): boolean {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface PromptDeps {
  question: (q: string) => Promise<string>;
}

function defaultPromptDeps(): PromptDeps {
  return {
    question: (q: string) =>
      new Promise((resolve) => {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.question(q, (answer) => {
          rl.close();
          resolve(answer);
        });
      }),
  };
}

async function askConfirm(deps: PromptDeps, question: string, defaultYes = true): Promise<boolean> {
  const answer = (await deps.question(question)).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function askValue(deps: PromptDeps, question: string): Promise<string> {
  const answer = (await deps.question(question)).trim();
  return answer;
}

interface InstallState {
  installId: string;
  startedAt: number;
  optedInToTelemetry: boolean;
}

function writeInstallState(state: InstallState): string {
  const dir = join(homedir(), '.holo');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, 'install-state.json');
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return path;
}

interface InitOptions {
  prompt?: PromptDeps;
  /** Override homedir for tests; defaults to os.homedir() via writeInstallState. */
  skipInstallStateWrite?: boolean;
}

export async function initCommand(_args: string[], opts: InitOptions = {}): Promise<void> {
  const deps = opts.prompt ?? defaultPromptDeps();
  const startedAt = Date.now();

  console.log('🚀 holo init — self-hosted context layer');
  console.log('');

  const platform = process.platform;
  if (platform === 'win32') {
    console.log('\n⚠️  Windows detected.');
    console.log('   holo runs best on WSL2. Install WSL2 first, then re-run inside the WSL2 terminal.');
    console.log('   Guide: https://learn.microsoft.com/en-us/windows/wsl/install\n');
  }

  if (!isCommandAvailable('docker')) {
    console.error('✗ docker not found. Please install Docker 24+ and try again.');
    console.error('  https://docs.docker.com/get-docker/');
    process.exit(1);
  }

  if (!isDockerComposeAvailable()) {
    console.error('✗ docker compose not available. Please install Docker Compose v2 and try again.');
    console.error('  https://docs.docker.com/compose/install/');
    process.exit(1);
  }

  console.log('✓ docker and docker compose found');
  console.log('');

  const cwd = process.cwd();
  const envPath = join(cwd, '.env');
  if (existsSync(envPath)) {
    const overwrite = await askConfirm(deps, '.env already exists. Overwrite? [Y/n] ');
    if (!overwrite) {
      console.log('Aborted. Existing .env was not modified.');
      process.exit(0);
    }
  }

  // GitHub-only quickstart per DX D44 — collect only what's needed for the
  // first MCP search to succeed. Everything else can be filled in via the
  // dashboard later. Empty values keep the <REPLACE_ME> placeholder so the
  // .env still loads but the relevant feature is disabled until edited.
  console.log('Quickstart needs three values to reach a first useful query.');
  console.log('Press Enter to skip and fill them in later.');
  console.log('');
  const anthropicKey = await askValue(deps, 'ANTHROPIC_API_KEY (sk-ant-…): ');
  const ghClientId = await askValue(deps, 'GitHub OAuth client ID (sign-in): ');
  const ghClientSecret = await askValue(deps, 'GitHub OAuth client secret (sign-in): ');

  // TTHW telemetry opt-in (DX D48). Default ON with a clear explanation.
  console.log(TELEMETRY_PRIVACY_NOTICE);
  const telemetryOptIn = await askConfirm(
    deps,
    'Send opt-in TTHW telemetry? [Y/n] ',
    true,
  );

  const installId = randomUUID();
  const postgresPassword = randomAlphanumeric(24);
  const betterAuthSecret = randomAlphanumeric(32);
  const tokenEncryptionKey = randomHex(32);

  const envLines = [
    `POSTGRES_USER=holo`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `POSTGRES_DB=holo`,
    `DATABASE_URL=postgresql://holo:${postgresPassword}@localhost:5436/holo`,
    `REDIS_URL=redis://localhost:6382`,
    `BETTER_AUTH_SECRET=${betterAuthSecret}`,
    `BETTER_AUTH_URL=http://localhost:3000`,
    `HOLO_TOKEN_ENCRYPTION_KEY=${tokenEncryptionKey}`,
    `ANTHROPIC_API_KEY=${anthropicKey || '<REPLACE_ME>'}`,
    `GITHUB_LOGIN_CLIENT_ID=${ghClientId || '<REPLACE_ME>'}`,
    `GITHUB_LOGIN_CLIENT_SECRET=${ghClientSecret || '<REPLACE_ME>'}`,
    `MCP_PUBLIC_URL=http://localhost:8080`,
    `WEB_PUBLIC_URL=http://localhost:3000`,
    `# TTHW telemetry — see ~/.holo/install-state.json. Edit OPT_IN to change later.`,
    `HOLO_TELEMETRY_INSTALL_ID=${installId}`,
    `HOLO_TELEMETRY_STARTED_AT=${startedAt}`,
    `HOLO_TELEMETRY_OPT_IN=${telemetryOptIn}`,
    '',
  ];
  writeFileSync(envPath, envLines.join('\n'), 'utf8');
  console.log('✓ Generated .env');

  // Persist install state to ~/.holo/install-state.json so the server can
  // verify which install this is on first MCP search. Distinct from the
  // .env vars: the home-dir copy is the audit trail; the env vars are how
  // the running server reads them.
  if (!opts.skipInstallStateWrite) {
    try {
      const path = writeInstallState({
        installId,
        startedAt,
        optedInToTelemetry: telemetryOptIn,
      });
      console.log(`✓ Wrote install state to ${path}`);
    } catch (err) {
      console.warn(`⚠️  Could not write ~/.holo/install-state.json: ${(err as Error).message}`);
      console.warn('   Continuing — telemetry opt-in flag is still set in .env.');
    }
  }

  // Bundled docker-compose template — write it if there isn't one already.
  const composePath = join(cwd, 'docker-compose.yml');
  const composeExisted = existsSync(composePath);
  if (!composeExisted) {
    writeFileSync(composePath, DOCKER_COMPOSE_TEMPLATE, 'utf8');
    console.log('✓ Generated docker-compose.yml');
  } else {
    console.log('✓ docker-compose.yml found (left untouched)');
  }

  console.log('');
  console.log('Next steps:');
  let stepNum = 1;
  if (!anthropicKey || !ghClientId || !ghClientSecret) {
    const missing: string[] = [];
    if (!anthropicKey) missing.push('ANTHROPIC_API_KEY');
    if (!ghClientId) missing.push('GITHUB_LOGIN_CLIENT_ID');
    if (!ghClientSecret) missing.push('GITHUB_LOGIN_CLIENT_SECRET');
    console.log(`  ${stepNum++}. Fill in ${missing.join(', ')} in .env`);
  }
  console.log(`  ${stepNum++}. Run: docker compose up -d`);
  console.log(`  ${stepNum++}. Open: http://localhost:3000`);
}
