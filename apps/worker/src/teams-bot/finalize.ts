import type { TeamsBotApiClient } from '@holo/connectors';
import type { Source } from '../slack-bot/agent.js';
import {
  answerActivity,
  errorActivity,
  placeholderActivity,
  PLACEHOLDER_TEXT,
} from './cards.js';

/**
 * Finalize an existing placeholder with the agent's answer + sources by
 * PUTing the activity in place. Mirrors `slack-bot/finalize.ts` and
 * `google-chat-bot/finalize.ts`: if the placeholder send failed (rate
 * limit, network), fall back to a fresh POST so the user isn't left
 * hanging.
 *
 * Returns the Activity id of the final reply so the caller can write a
 * `teams_answer_index` row for RFC-0008 (reaction → feedback). Null
 * when the Bot Connector didn't give us a usable id back.
 *
 * `logError` surfaces Bot Connector failures so silent drops show up in
 * worker logs rather than looking like a successful job that never
 * produced a reply (same pattern as the Slack/Google Chat handlers).
 */
export async function finalizeTeamsAnswer(args: {
  client: TeamsBotApiClient;
  serviceUrl: string;
  conversationId: string;
  placeholder: { activityId: string } | null;
  answer: string;
  sources: Source[];
  logError?: (message: string) => void;
}): Promise<{ activityId: string } | null> {
  const body = answerActivity(args.answer, args.sources);
  if (args.placeholder) {
    const res = await args.client.updateActivity({
      serviceUrl: args.serviceUrl,
      conversationId: args.conversationId,
      activityId: args.placeholder.activityId,
      body,
    });
    if (!res.ok) {
      args.logError?.(
        `teams-bot: updateActivity failed (activityId=${args.placeholder.activityId} error=${res.error ?? 'unknown'})`,
      );
      return null;
    }
    return { activityId: args.placeholder.activityId };
  }
  const res = await args.client.sendActivity({
    serviceUrl: args.serviceUrl,
    conversationId: args.conversationId,
    body,
  });
  if (res.ok && res.activityId) {
    return { activityId: res.activityId };
  }
  args.logError?.(
    `teams-bot: sendActivity final answer failed (conversationId=${args.conversationId} error=${res.error ?? 'unknown'})`,
  );
  return null;
}

export async function finalizeTeamsError(args: {
  client: TeamsBotApiClient;
  serviceUrl: string;
  conversationId: string;
  placeholder: { activityId: string } | null;
  logError?: (message: string) => void;
}): Promise<void> {
  const body = errorActivity();
  if (args.placeholder) {
    const res = await args.client.updateActivity({
      serviceUrl: args.serviceUrl,
      conversationId: args.conversationId,
      activityId: args.placeholder.activityId,
      body,
    });
    if (!res.ok) {
      args.logError?.(
        `teams-bot: updateActivity error fallback failed (activityId=${args.placeholder.activityId} error=${res.error ?? 'unknown'})`,
      );
    }
    return;
  }
  const res = await args.client.sendActivity({
    serviceUrl: args.serviceUrl,
    conversationId: args.conversationId,
    body,
  });
  if (!res.ok) {
    args.logError?.(
      `teams-bot: sendActivity error fallback failed (conversationId=${args.conversationId} error=${res.error ?? 'unknown'})`,
    );
  }
}

/**
 * Post the initial placeholder so progress patches have a target.
 * Returns the activity id, or null if the send failed — in which case
 * the caller skips progress updates and falls back to a direct send on
 * finalize. `logError` surfaces the failure reason so a silent drop is
 * visible in worker logs.
 */
export async function postTeamsPlaceholder(args: {
  client: TeamsBotApiClient;
  serviceUrl: string;
  conversationId: string;
  logError?: (message: string) => void;
}): Promise<{ activityId: string } | null> {
  const res = await args.client.sendActivity({
    serviceUrl: args.serviceUrl,
    conversationId: args.conversationId,
    body: placeholderActivity(),
  });
  if (!res.ok || !res.activityId) {
    args.logError?.(
      `teams-bot: sendActivity placeholder failed (conversationId=${args.conversationId} error=${res.error ?? 'unknown'})`,
    );
    return null;
  }
  return { activityId: res.activityId };
}

export { PLACEHOLDER_TEXT };
