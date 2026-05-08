import type { DB } from '@holo/db';
import type { CustomToolRow } from './types';
import { expandArgs } from './expand-args';
import { validateInput } from './validate-input';
import { runCommand } from './spawn-runner';
import { emitCustomToolInvocation } from './audit';

export interface CustomToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isCustom: true;
  run(
    ctx: { db: DB; organizationId: string; userId?: string },
    args: unknown,
  ): Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
    truncated: boolean;
    duration_ms: number;
  }>;
}

export function buildCustomToolDefinition(tool: CustomToolRow): CustomToolDefinition {
  const prefixParts: string[] = ['CUSTOM'];
  if (tool.readOnly) prefixParts.push('read-only');
  if (tool.scope) prefixParts.push(`scope: ${tool.scope}`);
  const prefixed = `[${prefixParts.join(' | ')}] ${tool.description}`;

  return {
    name: tool.name,
    description: prefixed,
    inputSchema: tool.inputSchema,
    isCustom: true,
    async run(ctx, rawArgs) {
      const args = validateInput(tool.inputSchema, rawArgs);
      const argv = expandArgs(tool.argsTemplate, args);
      const filteredEnv: Record<string, string> = {};
      for (const k of tool.envAllowlist) {
        const v = process.env[k];
        if (typeof v === 'string') filteredEnv[k] = v;
      }
      const result = await runCommand({
        command: tool.command,
        argv,
        env: filteredEnv,
        timeoutMs: tool.timeoutMs,
        maxOutputBytes: tool.maxOutputBytes,
      });
      emitCustomToolInvocation({ db: ctx.db, tool, args, userId: ctx.userId, result });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        truncated: result.truncated,
        duration_ms: result.durationMs,
      };
    },
  };
}
