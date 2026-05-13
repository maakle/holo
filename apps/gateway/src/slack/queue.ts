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
    }
  | {
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
    };

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
