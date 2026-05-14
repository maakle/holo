import { recordAgentEvent } from '@holo/audit';
import { type DB } from '@holo/db';

export const PLACEHOLDER_TEXT = '_holo is thinking…_';

/**
 * Strip a leading `<@UXXX>` mention so the search query is the user's actual
 * question, not our own bot ID. Slack puts the mention at the start of the
 * text for `app_mention` events.
 */
export function cleanQuery(text: string): string {
  return text.replace(/^\s*<@[^>]+>\s*/, '').trim();
}

export function recordAgentEventForSlack(args: {
  db: DB;
  organizationId: string;
  traceId: string;
  agentIdentity: string;
  event: 'model_call' | 'tool_call' | 'tool_error';
  fields: Record<string, unknown>;
}): void {
  const { db, organizationId, traceId, agentIdentity, event, fields } = args;
  if (event === 'model_call') {
    const model = typeof fields.model === 'string' ? fields.model : 'unknown';
    recordAgentEvent({
      db,
      organizationId,
      kind: 'llm_call',
      name: model,
      agentIdentity,
      traceId,
      latencyMs: typeof fields.durationMs === 'number' ? fields.durationMs : 0,
      metadata: {
        callIndex: fields.callIndex,
        stopReason: fields.stopReason,
        inputTokens: fields.inputTokens,
        outputTokens: fields.outputTokens,
        cacheCreationInputTokens: fields.cacheCreationInputTokens,
        cacheReadInputTokens: fields.cacheReadInputTokens,
      },
    });
    return;
  }
  const toolName = typeof fields.tool === 'string' ? fields.tool : 'unknown';
  const isError = event === 'tool_error';
  recordAgentEvent({
    db,
    organizationId,
    kind: 'tool_call',
    name: toolName,
    agentIdentity,
    traceId,
    latencyMs: typeof fields.durationMs === 'number' ? fields.durationMs : 0,
    inputJson:
      fields.input && typeof fields.input === 'object'
        ? (fields.input as Record<string, unknown>)
        : {},
    outputJson: isError
      ? { error: fields.error }
      : fields.output && typeof fields.output === 'object'
        ? (fields.output as Record<string, unknown>)
        : null,
    errorCode: isError ? 'TOOL_ERROR' : null,
  });
}

/**
 * Map an agent log event to a short Slack-friendly progress phrase. Returns
 * null when the event shouldn't trigger a placeholder update (e.g. the very
 * first model call — the placeholder already says "thinking").
 */
export function progressTextForEvent(
  event: 'model_call' | 'tool_call' | 'tool_error',
  fields: Record<string, unknown>,
): string | null {
  if (event === 'tool_call' || event === 'tool_error') {
    const tool = String(fields.tool ?? '');
    if (tool === 'search') return '_🔍 searching your sources…_';
    if (tool === 'bash') return '_📄 reading sources…_';
    if (tool === 'list_skills' || tool === 'get_skill' || tool === 'execute_skill') {
      return '_🛠 using a skill…_';
    }
    return `_🛠 using ${tool}…_`;
  }
  if (event === 'model_call') {
    const callIndex = typeof fields.callIndex === 'number' ? fields.callIndex : 0;
    if (callIndex > 1) return '_🧠 reasoning…_';
    return null;
  }
  return null;
}
