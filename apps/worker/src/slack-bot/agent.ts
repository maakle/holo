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
  /** Optional trace callback; receives one event per model call and per tool call. */
  logEvent?: (event: 'model_call' | 'tool_call' | 'tool_error', fields: Record<string, unknown>) => void;
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

type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type Message = { role: 'user' | 'assistant'; content: unknown };

const META_TOOLS = new Set(['list_skills', 'get_skill', 'execute_skill']);

function deriveSearchSourceTitle(args: {
  url: string;
  provider: string;
  kind: string;
  metadata: Record<string, unknown> | undefined;
}): string {
  const filePath = args.metadata?.file_path;
  if (typeof filePath === 'string' && filePath.length > 0) {
    const basename = filePath.split('/').pop();
    if (basename) return basename;
  }
  try {
    const u = new URL(args.url);
    const pathBasename = u.pathname.split('/').filter(Boolean).pop();
    if (pathBasename) return pathBasename;
  } catch {
    // not a parseable URL — fall through
  }
  return `${args.provider} · ${args.kind}`;
}

class SourceCollector {
  private readonly seen = new Set<string>();
  private readonly entries: Source[] = [];
  private readonly cap = 8;

  add(source: Source): void {
    if (this.entries.length >= this.cap) return;
    if (this.seen.has(source.url)) return;
    this.seen.add(source.url);
    this.entries.push(source);
  }

  ingestSearchResult(output: unknown): void {
    if (!output || typeof output !== 'object') return;
    const results = (output as { results?: unknown }).results;
    if (!Array.isArray(results)) return;
    for (const r of results.slice(0, 3)) {
      if (!r || typeof r !== 'object') continue;
      const url = (r as { snippet_url?: unknown }).snippet_url;
      const src = (r as {
        source?: {
          provider?: unknown;
          artifact_kind?: unknown;
          metadata?: Record<string, unknown>;
        };
      }).source;
      if (typeof url !== 'string' || !url) continue;
      const provider = typeof src?.provider === 'string' ? src.provider : 'unknown';
      const kind = typeof src?.artifact_kind === 'string' ? src.artifact_kind : 'unknown';
      const metadata =
        src?.metadata && typeof src.metadata === 'object' ? src.metadata : undefined;
      const title = deriveSearchSourceTitle({ url, provider, kind, metadata });
      this.add({ provider, kind, title, url });
    }
  }

  ingestArtifact(toolName: string, output: unknown): void {
    if (!output || typeof output !== 'object') return;
    const o = output as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : undefined;
    if (!url) return;
    const provider = typeof o.provider === 'string' ? o.provider : toolName;
    const kind = typeof o.kind === 'string' ? o.kind : 'artifact';
    const title = typeof o.title === 'string' ? o.title : `${provider} · ${kind}`;
    this.add({ provider, kind, title, url });
  }

  toArray(): Source[] {
    return this.entries.slice();
  }
}

// Anthropic's tool API requires `type: "object"` at the root of input_schema
// AND rejects `anyOf`/`oneOf`/`allOf` at the top level. Zod's z.toJSONSchema
// emits exactly those for unions (e.g. get_doc) and refined objects
// (e.g. get_skill). Flatten the branches into a merged `properties` map; the
// tool runner still validates via the original zod schema at runtime.
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

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  const system = SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName);
  const anthropicTools: AnthropicTool[] = deps.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toAnthropicInputSchema(t.inputSchema),
  }));
  const toolByName = new Map(deps.tools.map((t) => [t.name, t]));

  const ctx = {
    db: deps.db,
    organizationId: deps.organizationId,
    userSubjects: deps.userSubjects,
  };

  const messages: Message[] = [{ role: 'user', content: deps.question }];
  const maxToolCalls = deps.maxToolCalls ?? 20;
  let toolCallCount = 0;
  const wallClockMs = deps.wallClockMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const sources = new SourceCollector();
  const logEvent = deps.logEvent ?? (() => {});
  let modelCallCount = 0;

  while (true) {
    if (now() - startedAt > wallClockMs) {
      throw new AgentRunawayError(
        'wall_clock_cap',
        `agent exceeded wall clock budget (${wallClockMs}ms)`,
      );
    }
    const modelStart = now();
    const model = 'claude-sonnet-4-6';
    const response = (await deps.client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [...messages] as never,
      tools: anthropicTools as never,
    })) as {
      stop_reason: string;
      content: ContentBlock[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    modelCallCount += 1;
    logEvent('model_call', {
      callIndex: modelCallCount,
      model,
      durationMs: now() - modelStart,
      stopReason: response.stop_reason,
      elapsedMs: now() - startedAt,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') {
        console.warn(
          `[runAgent] response truncated by max_tokens for org=${deps.organizationId}`,
        );
      }
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer: text, sources: sources.toArray() };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        throw new AgentRunawayError(
          'tool_call_cap',
          `agent exceeded max tool calls (${maxToolCalls})`,
        );
      }
      if (now() - startedAt > wallClockMs) {
        throw new AgentRunawayError(
          'wall_clock_cap',
          `agent exceeded wall clock budget (${wallClockMs}ms)`,
        );
      }
      const tool = toolByName.get(use.name);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool ${use.name} not registered`,
          is_error: true,
        });
        continue;
      }
      const toolStart = now();
      try {
        const output = await tool.run(ctx, use.input);
        logEvent('tool_call', {
          tool: use.name,
          input: use.input,
          output,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
        });
        if (use.name === 'search') {
          sources.ingestSearchResult(output);
        } else if (!META_TOOLS.has(use.name)) {
          sources.ingestArtifact(use.name, output);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logEvent('tool_error', {
          tool: use.name,
          input: use.input,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
          error: message,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool error: ${message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
