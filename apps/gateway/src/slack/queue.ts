import { Queue } from 'bullmq';

export const SLACK_BOT_QUEUE = 'slack-bot';

/**
 * Job payload enqueued by the events / commands handlers and consumed by the
 * worker's SlackBotProcessor. We persist the minimal envelope; the worker
 * looks up the workspace credentials by team_id and decides what to do based
 * on `kind`.
 */
export type SlackBotJob =
  | {
      kind: 'app_mention';
      teamId: string;
      channel: string;
      threadTs: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'message_im';
      teamId: string;
      channel: string;
      threadTs?: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'slash_command';
      teamId: string;
      channel: string;
      asker: string;
      text: string;
      responseUrl: string;
    };

function parseRedisUrl(url: string): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

let queue: Queue<SlackBotJob> | null = null;

export function getSlackBotQueue(redisUrl: string): Queue<SlackBotJob> {
  if (!queue) {
    queue = new Queue<SlackBotJob>(SLACK_BOT_QUEUE, {
      connection: parseRedisUrl(redisUrl),
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
