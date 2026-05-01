import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline';

function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  // Use randomBytes to pick from the alphabet
  while (result.length < length) {
    const bytes = randomBytes(length * 2);
    for (const byte of bytes) {
      if (result.length >= length) break;
      // Only use bytes that map cleanly into the alphabet (avoid modulo bias)
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
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isDockerComposeAvailable(): boolean {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function askConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      // Default to yes if empty or 'y'/'yes'
      resolve(trimmed === '' || trimmed === 'y' || trimmed === 'yes');
    });
  });
}

export async function initCommand(_args: string[]): Promise<void> {
  console.log('🚀 holo init — self-hosted context layer');
  console.log('');

  // Detect OS
  const platform = process.platform;
  if (platform === 'win32') {
    console.log('⚠  Windows detected. holo init does not currently support Windows.');
    console.log('   Windows support is planned for v0.2. Use WSL2 in the meantime.');
    console.log('');
  } else if (platform === 'darwin') {
    // macOS is fully supported, no note needed
  } else if (platform === 'linux') {
    // Linux is fully supported, no note needed
  }

  // Check docker
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

  // Check if .env already exists
  const cwd = process.cwd();
  const envPath = join(cwd, '.env');
  if (existsSync(envPath)) {
    const overwrite = await askConfirm('.env already exists. Overwrite? [Y/n] ');
    if (!overwrite) {
      console.log('Aborted. Existing .env was not modified.');
      process.exit(0);
    }
  }

  // Generate secrets
  const postgresPassword = randomAlphanumeric(24);
  const betterAuthSecret = randomAlphanumeric(32);
  const tokenEncryptionKey = randomHex(32);

  // Build .env content
  const envContent = [
    `POSTGRES_USER=holo`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `POSTGRES_DB=holo`,
    `DATABASE_URL=postgresql://holo:${postgresPassword}@localhost:5436/holo`,
    `REDIS_URL=redis://localhost:6382`,
    `BETTER_AUTH_SECRET=${betterAuthSecret}`,
    `BETTER_AUTH_URL=http://localhost:3000`,
    `HOLO_TOKEN_ENCRYPTION_KEY=${tokenEncryptionKey}`,
    `ANTHROPIC_API_KEY=<REPLACE_ME>`,
    `GITHUB_LOGIN_CLIENT_ID=<REPLACE_ME>`,
    `GITHUB_LOGIN_CLIENT_SECRET=<REPLACE_ME>`,
    `MCP_PUBLIC_URL=http://localhost:8091`,
    `WEB_PUBLIC_URL=http://localhost:3000`,
    '',
  ].join('\n');

  writeFileSync(envPath, envContent, 'utf8');
  console.log('✓ Generated .env');

  // Check for docker-compose.yml
  const composePath = join(cwd, 'docker-compose.yml');
  const composeExists = existsSync(composePath);

  console.log('');

  if (composeExists) {
    console.log('✓ docker-compose.yml found');
    console.log('✓ .env generated');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Fill in ANTHROPIC_API_KEY, GITHUB_LOGIN_CLIENT_ID, GITHUB_LOGIN_CLIENT_SECRET in .env');
    console.log('  2. Run: docker compose up -d');
    console.log('  3. Open: http://localhost:3000');
  } else {
    console.log('✓ .env generated');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Copy docker-compose.yml from the holo repo to this directory');
    console.log(
      '     (or run: curl -fsSL https://raw.githubusercontent.com/your-org/holo/main/docker-compose.yml -o docker-compose.yml)',
    );
    console.log('  2. Fill in ANTHROPIC_API_KEY, GITHUB_LOGIN_CLIENT_ID, GITHUB_LOGIN_CLIENT_SECRET in .env');
    console.log('  3. Run: docker compose up -d');
    console.log('  4. Open: http://localhost:3000');
  }
}
