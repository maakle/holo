import { Queue } from 'bullmq';

export const GOOGLE_CHAT_BOT_QUEUE = 'google-chat-bot';

/**
 * Job payload enqueued by the events handler and consumed by the worker's
 * GoogleChatBotProcessor. Mirrors `SlackBotJob` in shape: we persist the
 * minimal envelope; the worker resolves the workspace, posts a placeholder
 * card, runs the agent, patches the placeholder, and (for reactions, v2)
 * writes a feedback row.
 *
 * `customerNumber` is the Google Workspace tenant id (Slack's `team_id`
 * analog). `spaceName` / `messageName` / `threadName` are Google's stable
 * resource names ("spaces/AAA", "spaces/AAA/messages/BBB", etc).
 */
export type GoogleChatBotJob =
  | {
      kind: 'mention';
      customerNumber: string;
      spaceName: string;
      threadName: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'dm';
      customerNumber: string;
      spaceName: string;
      threadName?: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      // Reserved for the post-launch reaction subscription. The worker
      // looks up `google_chat_answer_index` and writes an `answer_feedback`
      // row (RFC-0008 extension), parallel to slack-bot's path.
      kind: 'reaction';
      customerNumber: string;
      spaceName: string;
      messageName: string;
      asker: string;
      emoji: string;
      removed: boolean;
    };

let queue: Queue<GoogleChatBotJob> | null = null;

export function getGoogleChatBotQueue(redisUrl: string): Queue<GoogleChatBotJob> {
  if (!queue) {
    queue = new Queue<GoogleChatBotJob>(GOOGLE_CHAT_BOT_QUEUE, {
      connection: { url: redisUrl },
    });
  }
  return queue;
}

export async function enqueueGoogleChatBotJob(
  redisUrl: string,
  job: GoogleChatBotJob,
): Promise<void> {
  await getGoogleChatBotQueue(redisUrl).add(job.kind, job, {
    removeOnComplete: 200,
    removeOnFail: 200,
    attempts: 1,
  });
}
