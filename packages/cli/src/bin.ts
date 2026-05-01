#!/usr/bin/env node
import { initCommand } from './commands/init.js';
import { buildProgram } from './main.js';

const [, , command, ...args] = process.argv;

if (command === 'init' || !command) {
  await initCommand(args);
} else {
  // Delegate to the commander-based program for other subcommands
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
