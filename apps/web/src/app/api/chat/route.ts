import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { AnthropicLLMClient, type LLMMessage } from '@holo/llm';
import { getSubjectsForUser } from '@holo/user-subjects';
import { runChatAgentLoop, type ChatToolContext } from '@holo/agent-tools/chat';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { CHAT_MODEL_ID } from '@/lib/chat-model';
import { attachUserTurnToConversation, persistAssistantTurn } from './conversation';

export const runtime = 'nodejs';
// The agent loop can take longer than the default serverless slice; raise it
// to match the worker's wall-clock cap.
export const maxDuration = 60;

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});

const bodySchema = z.object({
  messages: z.array(turnSchema).min(1),
  conversationId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  try {
    const { auth, db, env } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });
    }
    if (!env.ANTHROPIC_API_KEY) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured on the server',
        fix: 'Set ANTHROPIC_API_KEY in the web app environment to enable the chat surface.',
      });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'invalid request body',
        fix: 'Send { messages: [{ role, text }] } with at least one message.',
      });
    }

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;
    const extraSubjects = await getSubjectsForUser(db, userId);
    const toolCtx: ChatToolContext = {
      db,
      organizationId: orgId,
      userSubjects: [`org:${orgId}`, `user:${userId}`, ...extraSubjects],
    };

    const conversationId = await attachUserTurnToConversation({
      db,
      organizationId: orgId,
      userId,
      conversationId: parsed.data.conversationId,
      messages: parsed.data.messages,
    });
    if (conversationId === 'not_found') {
      return NextResponse.json(
        { code: 'HOLO_NOT_FOUND', problem: 'conversation not found' },
        { status: 404 },
      );
    }

    const initialMessages: LLMMessage[] = parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    const result = await runChatAgentLoop({
      llm: new AnthropicLLMClient({ apiKey: env.ANTHROPIC_API_KEY }),
      model: CHAT_MODEL_ID,
      toolCtx,
      initialMessages,
    });

    if (result.kind === 'wall_clock_exceeded') {
      const problem = `agent exceeded wall clock budget (${result.wallClockMs}ms)`;
      await persistAssistantTurn({
        db,
        conversationId,
        text: `[error] ${problem}`,
        toolCalls: result.toolCalls,
        modelCalls: result.modelCalls,
      });
      return NextResponse.json(
        {
          answer: '',
          toolCalls: result.toolCalls,
          modelCalls: result.modelCalls,
          problem,
          code: 'HOLO_AGENT_WALLCLOCK',
        },
        { status: 504 },
      );
    }

    if (result.kind === 'tool_cap_exceeded') {
      const problem = `agent exceeded max tool calls (${result.maxToolCalls})`;
      await persistAssistantTurn({
        db,
        conversationId,
        text: `[error] ${problem}`,
        toolCalls: result.toolCalls,
        modelCalls: result.modelCalls,
      });
      return NextResponse.json(
        {
          answer: '',
          toolCalls: result.toolCalls,
          modelCalls: result.modelCalls,
          problem,
          code: 'HOLO_AGENT_TOOL_CAP',
        },
        { status: 429 },
      );
    }

    await persistAssistantTurn({
      db,
      conversationId,
      text: result.answer,
      toolCalls: result.toolCalls,
      modelCalls: result.modelCalls,
    });
    return NextResponse.json({
      answer: result.answer,
      toolCalls: result.toolCalls,
      modelCalls: result.modelCalls,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : e.code === 'HOLO_ENV_INVALID'
              ? 503
              : 400;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error('[api/chat] unexpected error', e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}
