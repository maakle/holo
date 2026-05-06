import type Anthropic from '@anthropic-ai/sdk';
import type { DB } from '@holo/db';
import type { ToolDefinition } from '@holo/agent-tools';

export interface Source {
  provider: string;
  kind: string;
  title: string;
  url: string;
}

export interface AgentResult {
  answer: string;
  sources: Source[];
}

export interface RunAgentDeps {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  question: string;
  /** Injected for tests. In production, instantiate per call from env. */
  client: Anthropic;
  /** Injected for tests. In production, call listTools() from @holo/agent-tools. */
  tools: ToolDefinition[];
  /** Org display name for the system prompt. */
  orgName: string;
  /** Defaults to 20. */
  maxToolCalls?: number;
  /** Defaults to 60_000 ms. */
  wallClockMs?: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

export class AgentRunawayError extends Error {
  constructor(public reason: 'tool_call_cap' | 'wall_clock_cap', message: string) {
    super(message);
    this.name = 'AgentRunawayError';
  }
}

const SYSTEM_PROMPT_TEMPLATE = `You are holo, a knowledge assistant for {org_name}. You have tools to search and fetch content from this organization's connected sources and to call any custom tools the organization has registered. Call whichever tools you need to answer the user's question — do not assume which sources are available; let the tool list and tool results tell you.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack mrkdwn), not markdown headers (#) or fenced code blocks unless quoting code. Bullets with \`- \` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.`;

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  const system = SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName);
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: deps.question },
  ];

  const response = await deps.client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system,
    messages: messages as never,
    tools: [] as never,
  });

  const text = (response.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => b.text ?? '')
    .join('\n')
    .trim();

  return { answer: text, sources: [] };
}
