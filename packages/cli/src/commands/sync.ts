import type { Command } from 'commander';
import { resolveDeps } from '../deps';
import { runSync, SYNC_PROVIDERS } from './sync-run';

export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .argument('<provider>', SYNC_PROVIDERS.join(' | '))
    .description('manually dispatch a sync job for every source of <provider>')
    .action(async (provider: string) => {
      const deps = resolveDeps();
      const out = await runSync({
        db: deps.db,
        organizationId: deps.organizationId,
        provider,
        redisUrl: deps.redisUrl,
      });
      const sourceLabel = out.sources.length === 1 ? 'source' : 'sources';
      const jobLabel = out.jobsEnqueued === 1 ? 'job' : 'jobs';
      console.log(
        `enqueued ${out.jobsEnqueued} ${jobLabel} across ${out.queueNames.join(', ')} ` +
          `for ${out.sources.length} ${out.provider} ${sourceLabel}.`,
      );
      for (const s of out.sources) {
        console.log(`  - ${s.name} (${s.id})`);
      }
    });
}
