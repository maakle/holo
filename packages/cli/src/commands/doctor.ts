import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface Check { name: string; pass: boolean; message: string; }

export async function doctorCommand(): Promise<void> {
  console.log('holo doctor — checking your setup\n');
  const checks: Check[] = [];

  try {
    execFileSync('docker', ['--version'], { stdio: 'pipe' });
    checks.push({ name: 'Docker', pass: true, message: 'found' });
  } catch {
    checks.push({ name: 'Docker', pass: false, message: 'not found — install Docker Desktop or Docker Engine' });
  }

  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'pipe' });
    checks.push({ name: 'Docker Compose', pass: true, message: 'found' });
  } catch {
    checks.push({ name: 'Docker Compose', pass: false, message: 'not found — requires Docker Compose v2' });
  }

  const envPath = join(process.cwd(), '.env');
  checks.push({
    name: '.env',
    pass: existsSync(envPath),
    message: existsSync(envPath) ? 'found' : 'not found — run `npx @holo/cli init` first',
  });

  const composePath = join(process.cwd(), 'docker-compose.yml');
  checks.push({
    name: 'docker-compose.yml',
    pass: existsSync(composePath),
    message: existsSync(composePath) ? 'found' : 'not found',
  });

  const major = parseInt(process.version.slice(1), 10);
  checks.push({
    name: 'Node.js',
    pass: major >= 20,
    message: major >= 20 ? `${process.version} (≥20 required)` : `${process.version} — requires Node.js 20+`,
  });

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? '✓' : '✗';
    const color = check.pass ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}${icon}\x1b[0m ${check.name}: ${check.message}`);
    if (!check.pass) allPass = false;
  }

  console.log('');
  if (allPass) {
    console.log('✓ All checks passed. Run `docker compose --profile app up -d` to start holo.');
  } else {
    console.log('✗ Some checks failed. Fix the issues above and run `holo doctor` again.');
    process.exit(1);
  }
}
