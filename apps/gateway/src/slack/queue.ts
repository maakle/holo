import { Queue } from 'bullmq';

export const SLACK_BOT_QUEUE = 'slack-bot';

/**
 * Job payload enqueued by the events / commands handlers and consumed by the
 * worker's SlackBotProcessor. We persist the minimal envelope; the worker
 * looks up the workspace credentials by team_id and decides what to do based
 * on `kind`.
 *
 * `slackAppConfigId` disambiguates which Slack app fired the event when one
 * workspace has both the shared Holo app AND a custom (EE) app installed.
 * Set to the slack_app_configs row id when the event arrived on the per-org
 * route; null when it arrived on the shared route. The worker uses it to
 * pick the matching connector_credentials row so chat.postMessage runs with
 * the right bot's token — without it, posting falls back to "most recently
 * refreshed" which routes Custom-Bot DMs to the wrong token and gets dropped
 * silently with channel_not_found.
 */
type SlackAppConfigHint = { slackAppConfigId: string | null };

export type SlackBotJob =
  | ({
      kind: 'app_mention';
      teamId: string;
      channel: string;
      threadTs: string;
      asker: string;
      text: string;
    } & SlackAppConfigHint)
  | ({
      kind: 'message_im';
      teamId: string;
      channel: string;
      threadTs?: string;
      asker: string;
      text: string;
    } & SlackAppConfigHint)
  | ({
      kind: 'slash_command';
      teamId: string;
      channel: string;
      asker: string;
      text: string;
      responseUrl: string;
    } & SlackAppConfigHint)
  | ({
      // RFC-0008 (slack extension). The user reacted to a bot reply; the
      // worker looks the message up in `slack_answer_index` and writes an
      // `answer_feedback` row.
      kind: 'reaction_added';
      teamId: string;
      channel: string;
      messageTs: string;
      asker: string;
      reaction: string;
      removed: boolean;
    } & SlackAppConfigHint);

let queue: Queue<SlackBotJob> | null = null;

export function getSlackBotQueue(redisUrl: string): Queue<SlackBotJob> {
  if (!queue) {
    queue = new Queue<SlackBotJob>(SLACK_BOT_QUEUE, {
      connection: { url: redisUrl },
    });
  }
  return queue;
}

export async function enqueueSlackBotJob(
  redisUrl: string,
  job: SlackBotJob,
): Promise<void> {
  await getSlackBotQueue(redisUrl).add(job.kind, job, {
    removeOnComplete: 200,
    removeOnFail: 200,
    attempts: 1,
  });
}
