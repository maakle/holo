import type { Command } from 'commander';
import { runConnectSlack } from './connect-slack';
import { resolveDeps } from '../deps';

export function registerConnectCommand(program: Command): void {
  const connect = program
    .command('connect')
    .description('connect a third-party tool by pasting credentials (no OAuth round-trip)');

  connect
    .command('slack')
    .description('connect Slack with a Bot User OAuth Token (xoxb-…)')
    .requiredOption('--token <token>', 'Bot User OAuth Token from api.slack.com')
    .action(async (opts: { token: string }) => {
      const deps = resolveDeps();
      const out = await runConnectSlack({
        db: deps.db,
        organizationId: deps.organizationId,
        userId: deps.userId,
        token: opts.token,
      });
      const verb = out.inserted ? 'connected' : 'updated';
      console.log(
        `Slack ${verb} for ${out.teamName} (team_id=${out.teamId}). ` +
          'Pick channels in /connections → Manage, or run a sync from the Manage sheet.',
      );
    });
}
