import { Queue } from 'bullmq';

export const TEAMS_BOT_QUEUE = 'teams-bot';

/**
 * `teamsAppConfigId` mirrors the disambiguation hint introduced for the
 * Slack BYO-app refactor and the Google Chat plan: null = shared Holo
 * bot route, UUID = the `teams_app_configs` row id from the per-org
 * BYO route. Required on every variant from day 1 so the worker never
 * has to guess which bot's credentials to mint outbound tokens against.
 * Today `teams_installations.tenant_id` is UNIQUE so the bug class isn't
 * reachable; this hint future-proofs against relaxing that constraint
 * (e.g. partner-shell scenarios).
 */
type TeamsAppConfigHint = { teamsAppConfigId: string | null };

export type TeamsBotJob =
  | ({
      kind: 'mention';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      askerName?: string;
      text: string;
    } & TeamsAppConfigHint)
  | ({
      kind: 'dm';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      askerName?: string;
      text: string;
    } & TeamsAppConfigHint)
  | ({
      // Reactions arrive on the same /api/messages endpoint as
      // messages (unlike Google Chat where they need a separate
      // Workspace Events subscription). The worker looks up
      // `teams_answer_index` by `replyToId` and routes the reaction to
      // the RFC-0008 feedback loop. v1 wires the path through; the
      // actual `answer_feedback` row write is deferred until Teams has
      // a per-user mapping table (parallel to `slack_user_credentials`).
      kind: 'reaction';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      replyToId: string;
      reactionType: string;
      removed: boolean;
    } & TeamsAppConfigHint);

let queue: Queue<TeamsBotJob> | null = null;

export function getTeamsBotQueue(redisUrl: string): Queue<TeamsBotJob> {
  if (!queue) {
    queue = new Queue<TeamsBotJob>(TEAMS_BOT_QUEUE, {
      connection: { url: redisUrl },
    });
  }
  return queue;
}

export async function enqueueTeamsBotJob(
  redisUrl: string,
  job: TeamsBotJob,
): Promise<void> {
  await getTeamsBotQueue(redisUrl).add(job.kind, job, {
    removeOnComplete: 200,
    removeOnFail: 200,
    attempts: 1,
  });
}
