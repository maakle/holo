import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    // Pretend `which docker` and `docker compose version` succeed.
    if (cmd === 'which' && args[0] === 'docker') return Buffer.from('/usr/bin/docker');
    if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') return Buffer.from('Docker Compose v2');
    throw new Error(`unexpected execFileSync(${cmd} ${args.join(' ')})`);
  }),
}));

let tmpDir: string;
let originalCwd: string;
const logs: string[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'holo-init-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  logs.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('initCommand', () => {
  it('generates a .env with secret-shaped values when none exists', async () => {
    // Re-import after mocks are in place so the module picks them up.
    const { initCommand } = await import('../src/commands/init.js');
    await initCommand([]);

    const envPath = join(tmpDir, '.env');
    expect(existsSync(envPath)).toBe(true);

    const env = readFileSync(envPath, 'utf8');

    // POSTGRES_PASSWORD: 24 alphanumeric chars
    const pwMatch = env.match(/^POSTGRES_PASSWORD=([A-Za-z0-9]+)$/m);
    expect(pwMatch?.[1]).toMatch(/^[A-Za-z0-9]{24}$/);

    // BETTER_AUTH_SECRET: 32 alphanumeric chars
    const authMatch = env.match(/^BETTER_AUTH_SECRET=([A-Za-z0-9]+)$/m);
    expect(authMatch?.[1]).toMatch(/^[A-Za-z0-9]{32}$/);

    // HOLO_TOKEN_ENCRYPTION_KEY: 64 hex chars (32 bytes)
    const keyMatch = env.match(/^HOLO_TOKEN_ENCRYPTION_KEY=([a-f0-9]+)$/m);
    expect(keyMatch?.[1]).toMatch(/^[a-f0-9]{64}$/);

    // DATABASE_URL embeds the same generated POSTGRES_PASSWORD
    const dbUrlMatch = env.match(/^DATABASE_URL=postgresql:\/\/holo:([^@]+)@localhost:5436\/holo$/m);
    expect(dbUrlMatch?.[1]).toBe(pwMatch?.[1]);

    // Replaceable placeholders rendered, not fake values
    expect(env).toMatch(/^ANTHROPIC_API_KEY=<REPLACE_ME>$/m);
    expect(env).toMatch(/^GITHUB_LOGIN_CLIENT_ID=<REPLACE_ME>$/m);
    expect(env).toMatch(/^GITHUB_LOGIN_CLIENT_SECRET=<REPLACE_ME>$/m);
  });

  it('generates a different secret on each run (high entropy)', async () => {
    const { initCommand } = await import('../src/commands/init.js');

    await initCommand([]);
    const first = readFileSync(join(tmpDir, '.env'), 'utf8');

    // Force a clean second-run by removing the file (no readline prompt path).
    rmSync(join(tmpDir, '.env'));

    await initCommand([]);
    const second = readFileSync(join(tmpDir, '.env'), 'utf8');

    const pw1 = first.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
    const pw2 = second.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
    expect(pw1).toBeTruthy();
    expect(pw2).toBeTruthy();
    expect(pw1).not.toBe(pw2);
  });

  it('detects docker-compose.yml and prints "found" in next steps', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');

    const { initCommand } = await import('../src/commands/init.js');
    await initCommand([]);

    const combined = logs.join('\n');
    expect(combined).toContain('docker-compose.yml found');
    expect(combined).not.toContain('Copy docker-compose.yml from the holo repo');
  });
});
