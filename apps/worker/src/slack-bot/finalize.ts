import { type SlackApiClient } from '@holo/connectors';
import { buildAgentAnswerBlocks, buildErrorBlocks, ERROR_FALLBACK_TEXT } from './blocks.js';
import { type Source } from './agent.js';

/**
 * Finalize an existing placeholder with the agent's answer + sources. If no
 * placeholder was successfully posted (rate limit, scope, etc.), fall back to
 * a direct chat.postMessage so the user isn't left hanging.
 */
export async function finalizeAgentAnswer(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  placeholder: { ts: string; channel: string } | null;
  answer: string;
  sources: Source[];
}): Promise<void> {
  const blocks = buildAgentAnswerBlocks(args.answer, args.sources);
  const fallback = args.answer || 'holo answered your question.';
  if (args.placeholder) {
    await args.client.chatUpdate({
      channel: args.placeholder.channel,
      ts: args.placeholder.ts,
      text: fallback,
      blocks,
    });
    return;
  }
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: fallback,
    blocks,
  });
}

/**
 * Replace a placeholder with the standard error message. Same fallback shape
 * as finalizeAgentAnswer.
 */
export async function finalizeAgentError(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  placeholder: { ts: string; channel: string } | null;
}): Promise<void> {
  const blocks = buildErrorBlocks();
  if (args.placeholder) {
    await args.client.chatUpdate({
      channel: args.placeholder.channel,
      ts: args.placeholder.ts,
      text: ERROR_FALLBACK_TEXT,
      blocks,
    });
    return;
  }
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: ERROR_FALLBACK_TEXT,
    blocks,
  });
}

export async function postSlashResponse(args: {
  responseUrl: string;
  inChannel: boolean;
  answer: string;
  sources: Source[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const blocks = args.answer
    ? buildAgentAnswerBlocks(args.answer, args.sources)
    : [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: 'Ask me a question — e.g. `/holo what do we know about onboarding?`',
          },
        },
      ];
  const fallback = args.answer || 'holo answered your question.';
  await fetchImpl(args.responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: args.inChannel ? 'in_channel' : 'ephemeral',
      replace_original: true,
      text: fallback,
      blocks,
    }),
  });
}
