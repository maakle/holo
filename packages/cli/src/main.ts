#!/usr/bin/env node
import { Command } from 'commander';
import { registerAllowlistCommand } from './commands/allowlist';
import { registerConnectCommand } from './commands/connect';
import { registerSyncCommand } from './commands/sync';
import { registerToolCommand } from './commands/tool';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('holo')
    .description('holo connector + retrieval CLI')
    .version('0.0.0')
    .showHelpAfterError(true)
    .exitOverride();

  registerAllowlistCommand(program);
  registerConnectCommand(program);
  registerSyncCommand(program);
  registerToolCommand(program);

  return program;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    const e = err as { code?: string; message?: string; exitCode?: number };
    if (
      e.code === 'commander.helpDisplayed' ||
      e.code === 'commander.help' ||
      e.code === 'commander.version' ||
      e.code === 'commander.unknownCommand'
    ) {
      process.exit(typeof e.exitCode === 'number' ? e.exitCode : 0);
    }
    if (e.code?.startsWith('HOLO_')) {
      console.error(`Error [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    throw err;
  }
}
