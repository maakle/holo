// Conversation persistence helpers for the chat route. Kept colocated with
// the route handler (not in a shared package) because they're tightly coupled
// to the chat surface's request/response shape and Drizzle schema.

import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { ChatToolCallTrace } from '@holo/agent-tools/chat';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Verify the conversation belongs to the caller's org+user and persist the
 * latest user turn (updating title if still 'New chat'). Returns the
 * conversation id when found, null when no conversationId was supplied,
 * or 'not_found' when the conversation isn't owned by the caller.
 */
export async function attachUserTurnToConversation(args: {
  db: DB;
  organizationId: string;
  userId: string;
  conversationId: string | undefined;
  messages: ConversationTurn[];
}): Promise<string | null | 'not_found'> {
  if (!args.conversationId) return null;

  const ownedRows = await args.db
    .select({
      id: schema.chatConversations.id,
      title: schema.chatConversations.title,
    })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, args.conversationId),
        eq(schema.chatConversations.organizationId, args.organizationId),
        eq(schema.chatConversations.userId, args.userId),
      ),
    )
    .limit(1);
  const owned = ownedRows[0];
  if (!owned) return 'not_found';

  let lastUserMessage: ConversationTurn | undefined;
  for (let i = args.messages.length - 1; i >= 0; i--) {
    const m = args.messages[i]!;
    if (m.role === 'user') {
      lastUserMessage = m;
      break;
    }
  }

  if (lastUserMessage) {
    await args.db.insert(schema.chatMessages).values({
      conversationId: owned.id,
      role: 'user',
      text: lastUserMessage.text,
    });
    const titleUpdate: { title?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (owned.title === 'New chat') {
      titleUpdate.title = lastUserMessage.text.slice(0, 80).trim() || 'New chat';
    }
    await args.db
      .update(schema.chatConversations)
      .set(titleUpdate)
      .where(eq(schema.chatConversations.id, owned.id));
  }

  return owned.id;
}

/** Append the assistant turn (with tool traces) and bump conversation updatedAt. */
export async function persistAssistantTurn(args: {
  db: DB;
  conversationId: string | null;
  text: string;
  toolCalls: ChatToolCallTrace[];
  modelCalls: number;
}): Promise<void> {
  if (!args.conversationId) return;
  await args.db.insert(schema.chatMessages).values({
    conversationId: args.conversationId,
    role: 'assistant',
    text: args.text,
    toolCalls: args.toolCalls,
    modelCalls: args.modelCalls,
  });
  await args.db
    .update(schema.chatConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.chatConversations.id, args.conversationId));
}
