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
 */
export async function finalizeChatAnswer(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
  placeholder: { messageName: string } | null;
  answer: string;
  sources: Source[];
}): Promise<{ messageName: string } | null> {
  const body = answerCard(args.answer, args.sources);
  if (args.placeholder) {
    const res = await args.client.patchMessage({
      name: args.placeholder.messageName,
      body,
    });
    return res.ok ? { messageName: args.placeholder.messageName } : null;
  }
  const res = await args.client.createMessage({
    parent: args.spaceName,
    body: { ...body, thread: args.threadName ? { name: args.threadName } : undefined },
    messageReplyOption: args.threadName
      ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      : undefined,
  });
  return res.ok && res.message ? { messageName: res.message.name } : null;
}

export async function finalizeChatError(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
  placeholder: { messageName: string } | null;
}): Promise<void> {
  const body = errorCard();
  if (args.placeholder) {
    await args.client.patchMessage({ name: args.placeholder.messageName, body });
    return;
  }
  await args.client.createMessage({
    parent: args.spaceName,
    body: { ...body, thread: args.threadName ? { name: args.threadName } : undefined },
    messageReplyOption: args.threadName
      ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
      : undefined,
  });
}

/**
 * Post the initial placeholder so progress patches have a target. Returns
 * the message name to update, or null if the create failed — in which case
 * the caller skips progress updates and falls back to a direct create on
 * finalize.
 */
export async function postPlaceholder(args: {
  client: GoogleChatAppApiClient;
  spaceName: string;
  threadName?: string;
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
  if (!res.ok || !res.message) return null;
  return { messageName: res.message.name };
}

export { PLACEHOLDER_TEXT };
