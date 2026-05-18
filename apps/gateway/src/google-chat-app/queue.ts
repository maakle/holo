import { Queue } from 'bullmq';

export const GOOGLE_CHAT_BOT_QUEUE = 'google-chat-bot';

/**
 * Job payload enqueued by the events handler and consumed by the worker's
 * GoogleChatBotProcessor. Mirrors `SlackBotJob` in shape: we persist the
 * minimal envelope; the worker resolves the workspace, posts a placeholder
 * card, runs the agent, patches the placeholder, and (for reactions, v2)
 * writes a feedback row.
 *
 * `domainId` is the Google Workspace tenant identifier (Slack's `team_id`
 * analog) — pulled from `user.domainId` on the inbound event. Despite the
 * name, this is what Chat events reliably carry; the older `customerNumber`
 * field is not present on modern payloads. `spaceName` / `messageName` /
 * `threadName` are Google's stable resource names ("spaces/AAA",
 * "spaces/AAA/messages/BBB", etc).
 */
export type GoogleChatBotJob =
  | {
      kind: 'mention';
      organizationId: string;
      spaceName: string;
      threadName: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'dm';
      organizationId: string;
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
      organizationId: string;
      spaceName: string;
      messageName: string;
      asker: string;
      emoji: string;
      removed: boolean;
    }
  | {
      // Multi-tenant onboarding fallback: when a MESSAGE event arrives
      // from an unregistered email domain, the bot DMs a plain
      // informational reply telling the asker their admin needs to
      // register the domain in Holo. No tokens, no links, no DB row —
      // just a heads-up so the bot isn't silent.
      kind: 'unbound-info';
      domainId: string;
      askerEmail: string | null;
      spaceName: string;
      threadName?: string;
      setupUrl: string;
      useSharedServiceAccount: true;
    }
  | {
      // Unsolicited welcome on ADDED_TO_SPACE / first DM. Required by the
      // Google Workspace Marketplace review: the app must greet on join
      // and the greeting must be distinct from `/help`. No org context is
      // needed — the bot was just added by Marketplace install or by a
      // user @mention, so the central SA always has post permission.
      kind: 'welcome';
      spaceName: string;
      useSharedServiceAccount: true;
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
