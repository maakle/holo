import type { Command } from 'commander';
import { runAllowlistAdd } from './allowlist-add.js';
import { runAllowlistRemove } from './allowlist-remove.js';
import { renderListGithub } from './allowlist-list-github.js';
import { resolveDeps } from '../deps.js';

export function registerAllowlistCommand(program: Command): void {
  const allowlist = program
    .command('allowlist')
    .description('manage connector allowlists');

  allowlist
    .command('add')
    .argument('<provider>', "'github' | 'slack' | 'notion'")
    .argument('<pattern>', 'glob (contains *) or exact id')
    .option('--exclude', 'mark the pattern as exclude rather than include')
    .option('-n, --note <note>', 'optional note explaining why')
    .action(async (provider: string, pattern: string, opts: { exclude?: boolean; note?: string }) => {
      const deps = resolveDeps();
      const id = await runAllowlistAdd({
        db: deps.db,
        organizationId: deps.organizationId,
        provider: provider as 'github' | 'slack' | 'notion',
        pattern,
        exclude: opts.exclude ?? false,
        note: opts.note,
      });
      console.log(`added ${id}`);
    });

  allowlist
    .command('remove')
    .argument('<id>', 'allowlist row id (uuid)')
    .action(async (id: string) => {
      const deps = resolveDeps();
      await runAllowlistRemove({
        db: deps.db,
        organizationId: deps.organizationId,
        id,
      });
      console.log(`removed ${id}`);
    });

  const list = allowlist
    .command('list')
    .description('list allowlist patterns by provider');

  list
    .command('github')
    .description('list github allowlist patterns (pure SQL dump)')
    .action(async () => {
      const deps = resolveDeps();
      process.stdout.write(
        await renderListGithub({ db: deps.db, organizationId: deps.organizationId }),
      );
    });

  // Slack and Notion list subcommands deferred to v0.1 (require live API
  // calls for coverage panel + bot-not-in-channel warnings).
}
