import type { AgentEventKind } from '@holo/db';

export interface EventRow {
  id: string;
  createdAt: string; // ISO
  kind: AgentEventKind;
  traceId: string | null;
  agentIdentity: string | null;
  toolName: string;
  latencyMs: number;
  errorCode: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}
