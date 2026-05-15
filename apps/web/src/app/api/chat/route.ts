import { headers } from 'next/headers';
import { z } from 'zod';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { VercelAILLMClient, type LLMMessage } from '@holo/llm';
import { getSubjectsForUser } from '@holo/user-subjects';
import {
  runChatAgentLoop,
  type ChatAgentEvent,
  type ChatToolContext,
} from '@holo/agent-tools/chat';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { CHAT_MODEL_ID } from '@/lib/chat-model';
import { attachUserTurnToConversation, persistAssistantTurn } from './conversation';

export const runtime = 'nodejs';
// Some serverless platforms (Vercel) enforce maxDuration; self-hosted Node
// (Railway, Docker) ignores it. Keep this slightly above
// HOLO_CHAT_WALL_CLOCK_MS so the orchestrator's own budget fires first and
// the client gets a clean error event rather than a platform-killed stream.
export const maxDuration = 120;

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
});

const bodySchema = z.object({
  messages: z.array(turnSchema).min(1),
  conversationId: z.string().uuid().optional(),
});

// Server-sent stream event written to the client as newline-delimited JSON.
// Mirrors the shape the ChatPanel expects when it parses each NDJSON line.
type ChatStreamEvent =
  | ChatAgentEvent
  | {
      type: 'done';
      /** Stable id minted by the orchestrator for this assistant turn;
       * the client attaches it to POST /v1/feedback so feedback maps to
       * the exact turn the user rated. Snake_case on the wire. */
      answer_id: string;
      answer: string;
      toolCalls: unknown[];
      modelCalls: number;
      // Optional fields added for RFC-0007 (structured claims envelope).
      // Older clients that ignore unknown fields keep working.
      claims?: unknown[];
    }
  | {
      type: 'error';
      problem: string;
      code: string;
    };

function errorResponse(e: HoloError): Response {
  const status =
    e.code === 'HOLO_AUTH_NO_SESSION'
      ? 401
      : e.code === 'HOLO_INVALID_INPUT'
        ? 400
        : e.code === 'HOLO_ENV_INVALID'
          ? 503
          : 400;
  return new Response(JSON.stringify(e.toJSON()), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: Request) {
  let setup: {
    db: Awaited<ReturnType<typeof getServerContext>>['db'];
    env: Awaited<ReturnType<typeof getServerContext>>['env'];
    orgId: string;
    userId: string;
    conversationId: string | null;
    initialMessages: LLMMessage[];
    extraSubjects: string[];
  };
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
    const conversationId = await attachUserTurnToConversation({
      db,
      organizationId: orgId,
      userId,
      conversationId: parsed.data.conversationId,
      messages: parsed.data.messages,
    });
    if (conversationId === 'not_found') {
      return new Response(
        JSON.stringify({ code: 'HOLO_NOT_FOUND', problem: 'conversation not found' }),
        { status: 404, headers: { 'content-type': 'application/json' } },
      );
    }

    const extraSubjects = await getSubjectsForUser(db, userId);
    setup = {
      db,
      env,
      orgId,
      userId,
      conversationId,
      initialMessages: parsed.data.messages.map((m) => ({
        role: m.role,
        content: m.text,
      })),
      extraSubjects,
    };
  } catch (e) {
    if (e instanceof HoloError) return errorResponse(e);
    console.error('[api/chat] unexpected setup error', e);
    return new Response(
      JSON.stringify({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const { db, env, orgId, userId, conversationId, initialMessages, extraSubjects } = setup;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };

      try {
        const toolCtx: ChatToolContext = {
          db,
          organizationId: orgId,
          userSubjects: [`org:${orgId}`, `user:${userId}`, ...extraSubjects],
        };

        const result = await runChatAgentLoop({
          llm: new VercelAILLMClient({ apiKey: env.ANTHROPIC_API_KEY! }),
          model: CHAT_MODEL_ID,
          toolCtx,
          initialMessages,
          wallClockMs: env.HOLO_CHAT_WALL_CLOCK_MS,
          onEvent: (event) => {
            send(event);
          },
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
          send({ type: 'error', problem, code: 'HOLO_AGENT_WALLCLOCK' });
        } else if (result.kind === 'tool_cap_exceeded') {
          const problem = `agent exceeded max tool calls (${result.maxToolCalls})`;
          await persistAssistantTurn({
            db,
            conversationId,
            text: `[error] ${problem}`,
            toolCalls: result.toolCalls,
            modelCalls: result.modelCalls,
          });
          send({ type: 'error', problem, code: 'HOLO_AGENT_TOOL_CAP' });
        } else {
          await persistAssistantTurn({
            db,
            conversationId,
            text: result.answer,
            toolCalls: result.toolCalls,
            modelCalls: result.modelCalls,
          });
          send({
            type: 'done',
            answer_id: result.answerId,
            answer: result.answer,
            toolCalls: result.toolCalls,
            modelCalls: result.modelCalls,
            ...(result.claims !== undefined ? { claims: result.claims } : {}),
          });
        }
      } catch (e) {
        console.error('[api/chat] stream error', e);
        const problem = e instanceof Error ? e.message : 'unexpected error';
        send({ type: 'error', problem, code: 'HOLO_INTERNAL' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
