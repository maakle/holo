import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ChatPanel, type ChatTurn } from '@/components/chat-panel';
import { CHAT_MODEL_ID } from '@/lib/chat-model';

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

const idSchema = z.string().uuid();

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { auth, db, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const { id } = await params;
  const idResult = idSchema.safeParse(id);
  if (!idResult.success) notFound();

  const orgId = resolveActiveOrgId(session);
  const convRows = await db
    .select({ id: schema.chatConversations.id })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.id, idResult.data),
        eq(schema.chatConversations.organizationId, orgId),
        eq(schema.chatConversations.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!convRows[0]) notFound();

  const messageRows = await db
    .select({
      id: schema.chatMessages.id,
      role: schema.chatMessages.role,
      text: schema.chatMessages.text,
      toolCalls: schema.chatMessages.toolCalls,
      modelCalls: schema.chatMessages.modelCalls,
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.conversationId, convRows[0].id))
    .orderBy(asc(schema.chatMessages.createdAt));

  const initialTurns: ChatTurn[] = messageRows.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    toolCalls: (m.toolCalls as ToolCallTrace[] | null) ?? undefined,
    modelCalls: m.modelCalls ?? undefined,
  }));

  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);

  return (
    <ChatPanel
      hasAnthropicKey={hasAnthropicKey}
      modelId={CHAT_MODEL_ID}
      conversationId={convRows[0].id}
      initialTurns={initialTurns}
    />
  );
}
