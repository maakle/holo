import type { Command } from 'commander';
import { runToolRegister } from './tool-register.js';
import { resolveDeps } from '../deps.js';

export function registerToolCommand(program: Command): void {
  const tool = program.command('tool').description('manage custom MCP tools (CLI-as-tool)');

  tool
    .command('register')
    .requiredOption('--name <name>', 'tool name (lowercase, 3-64 chars)')
    .requiredOption('--description <text>', 'human-readable description')
    .requiredOption('--command <bin>', 'binary to invoke (must be on PATH)')
    .requiredOption('--schema-file <path>', 'JSON Schema file for tool inputs')
    .option('--arg <part...>', 'argv template part (repeatable, order-preserved)')
    .option('--env-allow <var...>', 'env variable name to pass through (repeatable)')
    .option('--scope <text>', 'free-form audit label')
    .option('--read-only', 'advisory: tool only reads (does not enforce)', false)
    .option('--timeout-ms <n>', 'spawn timeout in ms (max 60000)', '30000')
    .option('--max-output-bytes <n>', 'stdout/stderr cap each (max 1048576)', '262144')
    .action(async (opts: Record<string, unknown>) => {
      const deps = resolveDeps();
      const id = await runToolRegister({
        db: deps.db,
        organizationId: deps.organizationId,
        userId: deps.userId,
        name: opts.name as string,
        description: opts.description as string,
        command: opts.command as string,
        schemaFile: opts.schemaFile as string,
        argsTemplate: (opts.arg as string[] | undefined) ?? [],
        envAllowlist: (opts.envAllow as string[] | undefined) ?? [],
        scope: (opts.scope as string | undefined) ?? null,
        readOnly: Boolean(opts.readOnly),
        timeoutMs: Number(opts.timeoutMs),
        maxOutputBytes: Number(opts.maxOutputBytes),
      });
      console.log(`registered ${id}`);
    });

  // list/show/unregister subcommands added in Task 12
}
