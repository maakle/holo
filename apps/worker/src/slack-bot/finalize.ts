import { type SlackApiClient } from '@holo/connectors';
import {
  buildAgentAnswerBlocks,
  buildAgentAnswerBlocksInline,
  buildAnswerMetadata,
  buildErrorBlocks,
  ERROR_FALLBACK_TEXT,
} from './blocks.js';
import { type Source } from './agent.js';

/**
 * Finalize an existing placeholder with the agent's answer + sources. If no
 * placeholder was successfully posted (rate limit, scope, etc.), fall back to
 * a direct chat.postMessage so the user isn't left hanging.
 *
 * Returns the slack channel + message ts of the final reply, so the caller
 * can index it (RFC-0008: `slack_answer_index` rows). When chat.update is
 * used (placeholder path), we already know the ts; when chat.postMessage is
 * the fallback, we surface the response ts. Returns null when slack didn't
 * give us a usable ts back (rate limit, scope) — feedback for that turn
 * will just be unattributable.
 */
export async function finalizeAgentAnswer(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  placeholder: { ts: string; channel: string } | null;
  answer: string;
  sources: Source[];
  logError?: (message: string) => void;
}): Promise<{ channel: string; ts: string } | null> {
  const blocks = buildAgentAnswerBlocks(args.answer, args.sources);
  // Attach metadata only when there are sources — the "Show sources" button
  // (and therefore the metadata round-trip) only renders in that case.
  const metadata = args.sources.length > 0 ? buildAnswerMetadata(args.sources) : undefined;
  const fallback = args.answer || 'holo answered your question.';
  if (args.placeholder) {
    const upd = await args.client.chatUpdate({
      channel: args.placeholder.channel,
      ts: args.placeholder.ts,
      text: fallback,
      blocks,
      metadata,
    });
    if (!upd.ok) {
      args.logError?.(
        `slack-bot: chat.update failed (channel=${args.placeholder.channel} ts=${args.placeholder.ts} error=${upd.error ?? 'unknown'})`,
      );
    }
    return { channel: args.placeholder.channel, ts: args.placeholder.ts };
  }
  const resp = await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: fallback,
    blocks,
    metadata,
  });
  if (resp?.ok && resp.ts && resp.channel) {
    return { channel: resp.channel, ts: resp.ts };
  }
  args.logError?.(
    `slack-bot: chat.postMessage final answer failed (channel=${args.channel} error=${resp?.error ?? 'unknown'})`,
  );
  return null;
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
  // Slash-command responses post via response_url. Ephemeral response_url
  // messages don't preserve `metadata`, which the channel-path button relies
  // on — so render the inline source list here regardless of in_channel/ephemeral
  // (keeps slash-command UX consistent and the source list immediately readable).
  const blocks = args.answer
    ? buildAgentAnswerBlocksInline(args.answer, args.sources)
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
