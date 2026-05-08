import { spawn } from 'node:child_process';
import type { RunResult } from './types';

export interface RunCommandInput {
  command: string;
  argv: string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export function runCommand(input: RunCommandInput): Promise<RunResult> {
  const { command, argv, env, timeoutMs, maxOutputBytes } = input;
  return new Promise((resolveP) => {
    const start = Date.now();
    const child = spawn(command, argv, {
      env: { ...env, PATH: process.env.PATH ?? '' }, // PATH is needed to resolve binaries
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let killed = false;

    const cap = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const current = which === 'stdout' ? stdout : stderr;
      if (current.length >= maxOutputBytes) {
        if (!killed) {
          killed = true;
          truncated = true;
          child.kill('SIGTERM');
        }
        return;
      }
      const room = maxOutputBytes - current.length;
      const text = chunk.toString('utf8');
      const slice = text.slice(0, room);
      if (which === 'stdout') stdout += slice;
      else stderr += slice;
      if (slice.length < text.length) {
        truncated = true;
        if (!killed) {
          killed = true;
          child.kill('SIGTERM');
        }
      }
    };

    child.stdout.on('data', cap('stdout'));
    child.stderr.on('data', cap('stderr'));

    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    let resolved = false;
    const finish = (r: RunResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolveP(r);
    };

    child.on('error', (err) => {
      finish({
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        exitCode: -1,
        truncated,
        durationMs: Date.now() - start,
      });
    });

    // Resolve on `exit` (process ended) rather than `close` (stdio pipes drained).
    // After SIGKILL, the kernel may take a noticeable moment to flush/close pipes —
    // observable as multi-second lag between SIGKILL and `close` on slow runners.
    // `exit` fires as soon as the process is gone; data we cared about already
    // arrived via earlier `data` events. The `resolved` guard makes a later
    // `close` a no-op.
    const onEnd = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish({
        stdout,
        stderr,
        exitCode: code ?? (signal ? -1 : 0),
        truncated,
        durationMs: Date.now() - start,
      });
    };
    child.on('exit', onEnd);
    child.on('close', onEnd);
  });
}
