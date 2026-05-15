import { AnthropicLLMClient } from '@holo/llm';
import { type DB } from '@holo/db';
import { listTools } from '@holo/agent-tools';
import { holoError, ErrorCode } from '@holo/errors';
import { runAgent, type AgentResult } from './agent.js';
import { fetchOrgName } from './workspace.js';
import { recordAgentEventForSlack, progressTextForEvent } from './agent-events.js';

export type AgentImpl = (input: {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  question: string;
  progress?: (text: string) => void;
}) => Promise<AgentResult>;

/**
 * Lazy default agent runner: only touches `listTools` + Anthropic SDK when no
 * override is supplied. Tests inject a stub via `SlackBotHandlerDeps.agentImpl`
 * and bypass both, keeping unit tests light.
 */
export function makeDefaultAgentRunner(deps: {
  db: DB;
  anthropicApiKey: string | undefined;
  traceId: string;
  agentIdentity: string;
  logInfo: (message: string, fields?: Record<string, unknown>) => void;
}): AgentImpl {
  return async (input) => {
    // TODO(task-12): startup validation in worker main.ts makes this unreachable in production.
    if (!deps.anthropicApiKey) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY not configured for the Slack bot agent',
        fix: 'Set ANTHROPIC_API_KEY in the worker env. The boot check in apps/worker/src/main.ts should normally prevent this branch from being reached.',
      });
    }
    const orgName = await fetchOrgName(deps.db, input.organizationId);
    const tools = await listTools({
      db: input.db,
      organizationId: input.organizationId,
      userSubjects: input.userSubjects,
    });
    deps.logInfo('slack-bot: agent starting', {
      organizationId: input.organizationId,
      orgName,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      questionPreview: input.question.slice(0, 120),
    });
    const llm = new AnthropicLLMClient({ apiKey: deps.anthropicApiKey });
    const startedAt = Date.now();
    const result = await runAgent({
      db: input.db,
      organizationId: input.organizationId,
      userSubjects: input.userSubjects,
      question: input.question,
      llm,
      tools,
      orgName,
      wallClockMs: 180_000,
      logEvent: (event, fields) => {
        deps.logInfo(`slack-bot: agent ${event}`, {
          organizationId: input.organizationId,
          ...summarizeFieldsForLog(fields),
        });
        recordAgentEventForSlack({
          db: deps.db,
          organizationId: input.organizationId,
          traceId: deps.traceId,
          agentIdentity: deps.agentIdentity,
          event,
          fields,
        });
        if (input.progress) {
          const text = progressTextForEvent(event, fields);
          if (text) input.progress(text);
        }
      },
    });
    deps.logInfo('slack-bot: agent finished', {
      organizationId: input.organizationId,
      durationMs: Date.now() - startedAt,
      answerLength: result.answer.length,
      sourceCount: result.sources.length,
    });
    return result;
  };
}

/**
 * Replace bulky tool `output` payloads with a small shape summary so log lines
 * stay readable. The full payload is still persisted in the agent_events DB
 * row by recordAgentEventForSlack.
 */
function summarizeFieldsForLog(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  if (!('output' in fields)) return fields;
  const { output, ...rest } = fields;
  return { ...rest, outputSummary: summarizeOutput(output) };
}

function summarizeOutput(output: unknown): unknown {
  if (output === null || output === undefined) return output;
  if (typeof output !== 'object') return output;
  if (Array.isArray(output)) return { array: true, length: output.length };
  const obj = output as Record<string, unknown>;
  if (Array.isArray(obj.results)) {
    const results = obj.results as unknown[];
    const topScore =
      results.length > 0 && typeof (results[0] as { score?: unknown }).score === 'number'
        ? (results[0] as { score: number }).score
        : undefined;
    return { resultCount: results.length, ...(topScore !== undefined ? { topScore } : {}) };
  }
  const keys = Object.keys(obj);
  return { keys, keyCount: keys.length };
}
