import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCommand } from '../src/spawn-runner';

const here = dirname(fileURLToPath(import.meta.url));
const ECHO = resolve(here, 'fixtures/echo-tool.sh');

describe('runCommand', () => {
  it('runs argv-only and returns stdout/exit', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: ['hello', 'world'],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split('\n')).toContain('hello');
    expect(r.stdout.split('\n')).toContain('world');
    expect(r.truncated).toBe(false);
  });

  it('passes only env-allowlisted vars', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: [],
      env: { CUSTOM_TOOLS_TEST_FOO: 'yes', CUSTOM_TOOLS_TEST_BAR: 'also' },
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_FOO=yes');
    expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_BAR=also');
  });

  it('strips env vars NOT in the allowlist (security control)', async () => {
    process.env.CUSTOM_TOOLS_TEST_SECRET = 'leak';
    try {
      const r = await runCommand({
        command: ECHO,
        argv: [],
        env: { CUSTOM_TOOLS_TEST_FOO: 'allowed' },
        timeoutMs: 5000,
        maxOutputBytes: 65536,
      });
      // Allowlisted var is present
      expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_FOO=allowed');
      // Non-allowlisted var is absent (printed as empty value, not 'leak')
      expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_SECRET=\n');
      expect(r.stdout).not.toContain('CUSTOM_TOOLS_TEST_SECRET=leak');
    } finally {
      delete process.env.CUSTOM_TOOLS_TEST_SECRET;
    }
  });

  it('does NOT shell-interpret argv (security control)', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: ['$(echo PWNED)', '`echo PWNED`', '; echo PWNED'],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).toBe(0);
    // If the shell had interpreted the args, we'd see a line that is *just* "PWNED".
    // Instead each argv is printed verbatim on its own line.
    expect(r.stdout.split('\n')).not.toContain('PWNED');
    expect(r.stdout).toContain('$(echo PWNED)');
    expect(r.stdout).toContain('`echo PWNED`');
    expect(r.stdout).toContain('; echo PWNED');
  });

  it('caps stdout at maxOutputBytes and flags truncated', async () => {
    // Use `yes` (POSIX), which prints "y\n" forever.
    const r = await runCommand({
      command: '/usr/bin/yes',
      argv: [],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(1024);
  });

  it(
    'kills child on timeout and returns truncated/error result',
    async () => {
      const r = await runCommand({
        command: '/bin/sh',
        argv: ['-c', 'sleep 5'],
        env: {},
        timeoutMs: 200,
        maxOutputBytes: 65536,
      });
      expect(r.exitCode).not.toBe(0); // timed out
      // Allow generous slack for slow CI runners; we just need to confirm
      // the runner didn't wait for the full 5s sleep.
      expect(r.durationMs).toBeLessThan(4000);
    },
    15_000,
  );
});
