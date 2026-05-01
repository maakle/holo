import type { Command } from 'commander';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .argument('<provider>', "'github' | 'slack' | 'notion'")
    .description('manually dispatch a sync job (worker integration in Phase 9)')
    .action(() => {
      console.error('sync command not yet wired — see Part 5 Task 9.2');
      process.exit(1);
    });
}
