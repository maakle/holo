-- Phase 2 of observability rebuild: widen mcp_invocations into a generic
-- event log. We keep the table name for now (renaming has wide blast
-- radius) and add the columns Phase 3 needs to record Slack messages,
-- agent steps, and LLM calls alongside MCP tool calls.
--
--   kind        — discriminator. 'mcp_call' for existing rows, future
--                 values: 'mcp_list', 'llm_call', 'slack_message',
--                 'agent_step', 'tool_call', 'connector_sync', 'rest_call'.
--   trace_id    — groups all events from a single user-visible interaction
--                 (e.g. one Slack thread reply, one MCP session turn).
--   parent_id   — self-FK for fine-grained nesting (an llm_call's child
--                 tool_calls point at the parent llm_call).
--   metadata    — kind-specific structured fields (tokens, cost, model,
--                 channel, ts, etc) without bloating input/output_json.

ALTER TABLE "mcp_invocations"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'mcp_call';

ALTER TABLE "mcp_invocations"
  ADD COLUMN IF NOT EXISTS "trace_id" uuid;

ALTER TABLE "mcp_invocations"
  ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "mcp_invocations"("id") ON DELETE SET NULL;

ALTER TABLE "mcp_invocations"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

CREATE INDEX IF NOT EXISTS "mcp_invocations_org_trace_idx"
  ON "mcp_invocations" ("organization_id", "trace_id", "created_at");

CREATE INDEX IF NOT EXISTS "mcp_invocations_org_kind_created_idx"
  ON "mcp_invocations" ("organization_id", "kind", "created_at" DESC);
