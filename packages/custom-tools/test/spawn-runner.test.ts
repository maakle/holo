import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCommand } from '../src/spawn-runner.js';

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

  it('kills child on timeout and returns truncated/error result', async () => {
    const r = await runCommand({
      command: '/bin/sh',
      argv: ['-c', 'sleep 5'],
      env: {},
      timeoutMs: 200,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).not.toBe(0); // timed out
    expect(r.durationMs).toBeLessThan(2000);
  });
});
