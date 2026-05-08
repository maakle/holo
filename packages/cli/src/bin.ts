#!/usr/bin/env node
import { initCommand } from './commands/init';
import { doctorCommand } from './commands/doctor';
import { buildProgram } from './main';

const [, , command, ...args] = process.argv;

if (command === 'init' || !command) {
  await initCommand(args);
} else if (command === 'doctor') {
  await doctorCommand();
} else {
  // Delegate to the commander-based program for other subcommands
  try {
    await buildProgram().parseAsync(process.argv);
  } catch (err) {
    const e = err as { code?: string; message?: string; exitCode?: number };
    // commander v12 throws CommanderError when --help is shown (helpDisplayed,
    // exitCode 0) and when the user types an unknown subcommand. Both are
    // already-rendered by commander; surface the requested exit code instead
    // of letting the throw escape and turn a successful --help into exit 1.
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
