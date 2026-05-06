import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import type { AgentEventKind } from '@holo/db';

export type AuditEventType =
  | 'skill_run.started'
  | 'skill_run.completed'
  | 'skill_run.failed'
  | 'api_token.created'
  | 'api_token.revoked'
  | 'skill.published'
  | 'skill.synthesized'
  | 'member.invited'
  | 'custom_tool.invoked'
  | 'user_subjects.refreshed';

export interface EmitAuditEventInput {
  db: DB;
  organizationId: string;
  userId?: string;
  eventType: AuditEventType;
  resourceType: string;
  resourceId?: string;
  meta?: Record<string, unknown>;
}

/** Fire-and-forget audit event emit. Never throws — errors are swallowed. */
export function emitAuditEvent(input: EmitAuditEventInput): void {
  const { db, organizationId, userId, eventType, resourceType, resourceId, meta } = input;
  db.insert(schema.auditEvents)
    .values({
      organizationId,
      userId: userId ?? null,
      eventType,
      resourceType,
      resourceId: resourceId ?? null,
      meta: meta ?? {},
    })
    .catch(() => {
      // audit failures are non-fatal
    });
}

export interface RecordAgentEventInput {
  db: DB;
  organizationId: string;
  kind: AgentEventKind;
  /**
   * Display name for the event (column reused from mcp_invocations.tool_name).
   * For mcp_call: tool name. For llm_call: model. For slack_message: 'inbound'/'outbound'.
   */
  name: string;
  agentIdentity?: string | null;
  traceId?: string | null;
  parentId?: string | null;
  inputJson?: Record<string, unknown>;
  outputJson?: Record<string, unknown> | null;
  errorCode?: string | null;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget agent event log. Returns the event id synchronously
 * (generated client-side as a uuid via gen_random_uuid would require a
 * round-trip — we let postgres assign and discard the id since the only
 * caller that needs ids is parent_id chaining, which can use a returning()
 * variant if needed).
 *
 * Errors are logged via the optional onError hook and swallowed.
 */
export function recordAgentEvent(
  input: RecordAgentEventInput,
  onError?: (err: unknown) => void,
): void {
  const {
    db,
    organizationId,
    kind,
    name,
    agentIdentity,
    traceId,
    parentId,
    inputJson,
    outputJson,
    errorCode,
    latencyMs,
    metadata,
  } = input;
  try {
    db.insert(schema.mcpInvocations)
      .values({
        organizationId,
        kind,
        traceId: traceId ?? null,
        parentId: parentId ?? null,
        agentIdentity: agentIdentity ?? null,
        toolName: name,
        inputJson: inputJson ?? {},
        outputJson: outputJson ?? null,
        errorCode: errorCode ?? null,
        latencyMs: latencyMs ?? 0,
        metadata: metadata ?? null,
      })
      .catch((err: unknown) => {
        if (onError) onError(err);
      });
  } catch (err) {
    // Synchronous failures (e.g. DB stub in tests without insert()) are also
    // non-fatal — agent event logging must never break the caller.
    if (onError) onError(err);
  }
}

/** Variant that awaits the insert and returns the new event id. */
export async function recordAgentEventReturning(
  input: RecordAgentEventInput,
): Promise<string> {
  const {
    db,
    organizationId,
    kind,
    name,
    agentIdentity,
    traceId,
    parentId,
    inputJson,
    outputJson,
    errorCode,
    latencyMs,
    metadata,
  } = input;
  const rows = await db
    .insert(schema.mcpInvocations)
    .values({
      organizationId,
      kind,
      traceId: traceId ?? null,
      parentId: parentId ?? null,
      agentIdentity: agentIdentity ?? null,
      toolName: name,
      inputJson: inputJson ?? {},
      outputJson: outputJson ?? null,
      errorCode: errorCode ?? null,
      latencyMs: latencyMs ?? 0,
      metadata: metadata ?? null,
    })
    .returning({ id: schema.mcpInvocations.id });
  return rows[0]!.id;
}
