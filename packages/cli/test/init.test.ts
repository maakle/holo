import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd === 'which' && args[0] === 'docker') return Buffer.from('/usr/bin/docker');
    if (cmd === 'docker' && args[0] === 'compose' && args[1] === 'version') return Buffer.from('Docker Compose v2');
    throw new Error(`unexpected execFileSync(${cmd} ${args.join(' ')})`);
  }),
}));

let tmpDir: string;
let originalCwd: string;
const logs: string[] = [];

/**
 * Build a stub prompt that returns each scripted answer in order. The init
 * flow asks (in order): ANTHROPIC_API_KEY, github client id, github client
 * secret, telemetry opt-in. If `.env` already exists, an extra overwrite
 * confirm is asked first — pass that as the leading entry.
 */
function scriptedPrompt(answers: string[]) {
  let i = 0;
  return {
    question: async (_q: string) => {
      const v = answers[i++];
      return v === undefined ? '' : v;
    },
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'holo-init-test-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  logs.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('initCommand', () => {
  it('generates a .env with secret-shaped values when none exists', async () => {
    const { initCommand } = await import('../src/commands/init');
    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', '']), // skip anthropic + gh + gh-secret + telemetry default
      skipInstallStateWrite: true,
    });

    const env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(/^POSTGRES_PASSWORD=[A-Za-z0-9]{24}$/m);
    expect(env).toMatch(/^BETTER_AUTH_SECRET=[A-Za-z0-9]{32}$/m);
    expect(env).toMatch(/^HOLO_TOKEN_ENCRYPTION_KEY=[a-f0-9]{64}$/m);

    const pwMatch = env.match(/^POSTGRES_PASSWORD=([A-Za-z0-9]+)$/m);
    const dbUrlMatch = env.match(/^DATABASE_URL=postgresql:\/\/holo:([^@]+)@localhost:5436\/holo$/m);
    expect(dbUrlMatch?.[1]).toBe(pwMatch?.[1]);

    expect(env).toMatch(/^ANTHROPIC_API_KEY=<REPLACE_ME>$/m);
    expect(env).toMatch(/^GITHUB_LOGIN_CLIENT_ID=<REPLACE_ME>$/m);
    expect(env).toMatch(/^GITHUB_LOGIN_CLIENT_SECRET=<REPLACE_ME>$/m);
  });

  it('substitutes interactive answers into .env when provided', async () => {
    const { initCommand } = await import('../src/commands/init');
    // Test fixtures intentionally chosen with low entropy and no secret-shaped
    // prefixes so a per-PR secret scanner doesn't flag them.
    const ANTHROPIC = 'PLACEHOLDER-ANTHROPIC';
    const GH_ID = 'PLACEHOLDER-GH-CLIENT-A';
    const GH_AUTH = 'PLACEHOLDER-GH-CLIENT-B';
    await initCommand([], {
      prompt: scriptedPrompt([ANTHROPIC, GH_ID, GH_AUTH, 'n']),
      skipInstallStateWrite: true,
    });

    const env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(new RegExp(`^ANTHROPIC_API_KEY=${ANTHROPIC}$`, 'm'));
    expect(env).toMatch(new RegExp(`^GITHUB_LOGIN_CLIENT_ID=${GH_ID}$`, 'm'));
    expect(env).toMatch(new RegExp(`^GITHUB_LOGIN_CLIENT_SECRET=${GH_AUTH}$`, 'm'));
  });

  it('writes TTHW telemetry env vars (install id, started_at, opt-in)', async () => {
    const { initCommand } = await import('../src/commands/init');
    const before = Date.now();
    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', 'y']),
      skipInstallStateWrite: true,
    });
    const after = Date.now();

    const env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(
      /^HOLO_TELEMETRY_INSTALL_ID=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/m,
    );
    expect(env).toMatch(/^HOLO_TELEMETRY_OPT_IN=true$/m);

    const startedAtMatch = env.match(/^HOLO_TELEMETRY_STARTED_AT=(\d+)$/m);
    expect(startedAtMatch).toBeTruthy();
    const startedAt = Number(startedAtMatch![1]);
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('respects telemetry opt-out', async () => {
    const { initCommand } = await import('../src/commands/init');
    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', 'n']),
      skipInstallStateWrite: true,
    });
    const env = readFileSync(join(tmpDir, '.env'), 'utf8');
    expect(env).toMatch(/^HOLO_TELEMETRY_OPT_IN=false$/m);
  });

  it('writes a docker-compose.yml when one does not exist', async () => {
    const { initCommand } = await import('../src/commands/init');
    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', '']),
      skipInstallStateWrite: true,
    });

    const compose = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('pgvector/pgvector:pg16');
    expect(compose).toContain('redis:7-alpine');
    expect(compose).toContain('HOLO_TELEMETRY_OPT_IN');

    const combined = logs.join('\n');
    expect(combined).toContain('Generated docker-compose.yml');
  });

  it('leaves an existing docker-compose.yml untouched', async () => {
    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');

    const { initCommand } = await import('../src/commands/init');
    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', '']),
      skipInstallStateWrite: true,
    });

    const compose = readFileSync(join(tmpDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toBe('services: {}\n');

    const combined = logs.join('\n');
    expect(combined).toContain('docker-compose.yml found');
    expect(combined).not.toContain('Generated docker-compose.yml');
  });

  it('generates a different installId on each run', async () => {
    const { initCommand } = await import('../src/commands/init');

    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', '']),
      skipInstallStateWrite: true,
    });
    const first = readFileSync(join(tmpDir, '.env'), 'utf8');

    rmSync(join(tmpDir, '.env'));
    rmSync(join(tmpDir, 'docker-compose.yml'));

    await initCommand([], {
      prompt: scriptedPrompt(['', '', '', '']),
      skipInstallStateWrite: true,
    });
    const second = readFileSync(join(tmpDir, '.env'), 'utf8');

    const id1 = first.match(/^HOLO_TELEMETRY_INSTALL_ID=(.+)$/m)?.[1];
    const id2 = second.match(/^HOLO_TELEMETRY_INSTALL_ID=(.+)$/m)?.[1];
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});
