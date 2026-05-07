import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { listTools, type ToolContext, type ToolDefinition } from '@holo/agent-tools';
import { AnthropicLLMClient, type LLMMessage, type LLMTool } from '@holo/llm';
import { getSubjectsForUser } from '@holo/user-subjects';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

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
});

interface ToolCallTrace {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  durationMs?: number;
}

const SYSTEM_PROMPT = `You are holo, a knowledge assistant. You have tools to search and fetch content from this organization's connected sources, plus tools to list and execute skills and any custom tools registered for the org. Use whichever tools you need to answer the user's question — do not assume which sources are available; let the tool list and tool results tell you.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Keep answers concise. Use plain markdown if formatting helps; do not wrap responses in fenced code blocks unless quoting code.
- If you cannot find an answer, say so directly — do not invent one.
- This is an interactive web chat used to test the holo agent surface; explaining which tools you used is welcome when relevant.`;

// Anthropic rejects anyOf/oneOf/allOf at the top level of input_schema and
// requires { type: "object" }. Mirror the worker's flattener.
function toAnthropicInputSchema(raw: unknown): Record<string, unknown> {
  const schema = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const branches =
    (schema['anyOf'] as unknown) ??
    (schema['oneOf'] as unknown) ??
    (schema['allOf'] as unknown);

  if (Array.isArray(branches)) {
    const properties: Record<string, unknown> = {};
    for (const branch of branches) {
      if (branch && typeof branch === 'object') {
        const branchProps = (branch as { properties?: Record<string, unknown> }).properties;
        if (branchProps) Object.assign(properties, branchProps);
      }
    }
    const { anyOf: _a, oneOf: _o, allOf: _al, type: _t, properties: _p, ...rest } = schema;
    return { ...rest, type: 'object', properties };
  }

  if (schema['type'] === 'object') return schema;
  return { type: 'object', ...schema };
}

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId, env } = await getServerContext();
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

    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const userId = session.user.id;
    const extraSubjects = await getSubjectsForUser(db, userId);
    const ctx: ToolContext = {
      db,
      organizationId: orgId,
      userId,
      userSubjects: [`org:${orgId}`, `user:${userId}`, ...extraSubjects],
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      agentIdentity: 'web-chat',
    };

    const tools = await listTools(ctx);
    const toolByName = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));
    const llmTools: LLMTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toAnthropicInputSchema(t.inputSchema),
    }));

    const client = new AnthropicLLMClient({ apiKey: env.ANTHROPIC_API_KEY });

    const messages: LLMMessage[] = parsed.data.messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    const traces: ToolCallTrace[] = [];
    const maxToolCalls = 12;
    const wallClockMs = 55_000;
    const startedAt = Date.now();
    let toolCallCount = 0;
    let modelCalls = 0;

    while (true) {
      if (Date.now() - startedAt > wallClockMs) {
        return NextResponse.json(
          {
            answer: '',
            toolCalls: traces,
            modelCalls,
            problem: `agent exceeded wall clock budget (${wallClockMs}ms)`,
            code: 'HOLO_AGENT_WALLCLOCK',
          },
          { status: 504 },
        );
      }

      const response = await client.complete({
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        tools: llmTools,
      });
      modelCalls += 1;

      // Carry the assistant turn forward (text + any tool_use blocks).
      messages.push({ role: 'assistant', content: response.content });

      if (response.stopReason !== 'tool_use') {
        const text = response.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return NextResponse.json({
          answer: text,
          toolCalls: traces,
          modelCalls,
        });
      }

      const toolUses = response.content.filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use',
      );

      const toolResults = [];
      for (const use of toolUses) {
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          return NextResponse.json(
            {
              answer: '',
              toolCalls: traces,
              modelCalls,
              problem: `agent exceeded max tool calls (${maxToolCalls})`,
              code: 'HOLO_AGENT_TOOL_CAP',
            },
            { status: 429 },
          );
        }
        const tool = toolByName.get(use.name);
        const callStart = Date.now();
        if (!tool) {
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output: `tool ${use.name} not registered`,
            isError: true,
            durationMs: Date.now() - callStart,
          };
          traces.push(trace);
          toolResults.push({
            type: 'tool_result' as const,
            toolUseId: use.id,
            content: trace.output as string,
            isError: true,
          });
          continue;
        }
        try {
          const output = await tool.run(ctx, use.input);
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output,
            durationMs: Date.now() - callStart,
          };
          traces.push(trace);
          toolResults.push({
            type: 'tool_result' as const,
            toolUseId: use.id,
            content: JSON.stringify(output),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const trace: ToolCallTrace = {
            id: use.id,
            name: use.name,
            input: use.input,
            output: `tool error: ${message}`,
            isError: true,
            durationMs: Date.now() - callStart,
          };
          traces.push(trace);
          toolResults.push({
            type: 'tool_result' as const,
            toolUseId: use.id,
            content: `tool error: ${message}`,
            isError: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
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
