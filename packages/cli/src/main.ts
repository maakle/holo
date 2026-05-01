#!/usr/bin/env node
import { Command } from 'commander';
import { registerAllowlistCommand } from './commands/allowlist.js';
import { registerSyncCommand } from './commands/sync.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('holo')
    .description('holo connector + retrieval CLI')
    .version('0.0.0')
    .showHelpAfterError(true)
    .exitOverride();

  registerAllowlistCommand(program);
  registerSyncCommand(program);

  return program;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'commander.unknownCommand' || e.code === 'commander.help') {
      process.exit(e.code === 'commander.help' ? 0 : 1);
    }
    if (e.code?.startsWith('HOLO_')) {
      console.error(`Error [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    throw err;
  }
}
