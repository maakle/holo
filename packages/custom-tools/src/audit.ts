import type { DB } from '@holo/db';
import { emitAuditEvent } from '@holo/audit';
import type { RunResult, CustomToolRow } from './types.js';

export interface EmitInvocationInput {
  db: DB;
  tool: CustomToolRow;
  args: Record<string, unknown>;
  userId?: string;
  result: RunResult;
}

export function emitCustomToolInvocation(input: EmitInvocationInput): void {
  const { db, tool, args, userId, result } = input;
  emitAuditEvent({
    db,
    organizationId: tool.organizationId,
    userId,
    eventType: 'custom_tool.invoked',
    resourceType: 'custom_tool',
    resourceId: tool.id,
    meta: {
      tool_name: tool.name,
      args,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      truncated: result.truncated,
      scope: tool.scope,
      read_only: tool.readOnly,
    },
  });
}
