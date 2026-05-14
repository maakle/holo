import type { GoogleChatAppApiClient } from '@holo/connectors';
import type { Source } from '../slack-bot/agent.js';
import {
  answerCard,
  errorCard,
  placeholderCard,
  PLACEHOLDER_TEXT,
} from './cards.js';

/**
 * Finalize an existing placeholder with the agent's answer + sources by
 * patching the message in place. Mirrors `slack-bot/finalize.ts` — if the
 * placeholder wasn't posted successfully (rate limit, network), fall back
 * to a fresh create so the user isn't left hanging.
 *
 * Returns the Chat-side message name (`spaces/AAA/messages/BBB`) of the
 * final reply so the caller can write a `google_chat_answer_index` row
 * for RFC-0008. Null when Chat didn't give us a usable name back.
 *
 * `logError` surfaces Chat API failures so silent drops show up in worker
 * logs rather than looking like a successful job that never produced a
 * reply (mirrors the slack-bot/finalize.ts pattern from main).
 */
export async function finalizeChatAnswer(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
  placeholder: { messageName: string } | null;
  answer: string;
  sources: Source[];
  logError?: (message: string) => void;
}): Promise<{ messageName: string } | null> {
  const body = answerCard(args.answer, args.sources);
  if (args.placeholder) {
    const res = await args.client.patchMessage({
      name: args.placeholder.messageName,
      body,
    });
    if (!res.ok) {
      args.logError?.(
        `google-chat-bot: messages.patch failed (name=${args.placeholder.messageName} error=${res.error ?? 'unknown'})`,
      );
      return null;
    }
    return { messageName: args.placeholder.messageName };
  }
  const res = await args.client.createMessage({
    parent: args.spaceName,
    body: { ...body, thread: args.threadName ? { name: args.threadName } : undefined },
    messageReplyOption: args.threadName
      ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      : undefined,
  });
  if (res.ok && res.message) {
    return { messageName: res.message.name };
  }
  args.logError?.(
    `google-chat-bot: messages.create final answer failed (parent=${args.spaceName} error=${res.error ?? 'unknown'})`,
  );
  return null;
}

export async function finalizeChatError(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
  placeholder: { messageName: string } | null;
  logError?: (message: string) => void;
}): Promise<void> {
  const body = errorCard();
  if (args.placeholder) {
    const res = await args.client.patchMessage({
      name: args.placeholder.messageName,
      body,
    });
    if (!res.ok) {
      args.logError?.(
        `google-chat-bot: messages.patch error fallback failed (name=${args.placeholder.messageName} error=${res.error ?? 'unknown'})`,
      );
    }
    return;
  }
  const res = await args.client.createMessage({
    parent: args.spaceName,
    body: { ...body, thread: args.threadName ? { name: args.threadName } : undefined },
    messageReplyOption: args.threadName
      ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      : undefined,
  });
  if (!res.ok) {
    args.logError?.(
      `google-chat-bot: messages.create error fallback failed (parent=${args.spaceName} error=${res.error ?? 'unknown'})`,
    );
  }
}

/**
 * Post the initial placeholder so progress patches have a target. Returns
 * the message name to update, or null if the create failed — in which case
 * the caller skips progress updates and falls back to a direct create on
 * finalize. `logError` surfaces the failure reason so a silent drop is
 * visible in worker logs.
 */
export async function postPlaceholder(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
  logError?: (message: string) => void;
}): Promise<{ messageName: string } | null> {
  const res = await args.client.createMessage({
    parent: args.spaceName,
    body: {
      ...placeholderCard(),
      thread: args.threadName ? { name: args.threadName } : undefined,
    },
    messageReplyOption: args.threadName
      ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      : undefined,
  });
  if (!res.ok || !res.message) {
    args.logError?.(
      `google-chat-bot: messages.create placeholder failed (parent=${args.spaceName} error=${res.error ?? 'unknown'})`,
    );
    return null;
  }
  return { messageName: res.message.name };
}

export { PLACEHOLDER_TEXT };
