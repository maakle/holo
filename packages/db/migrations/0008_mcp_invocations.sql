CREATE TABLE IF NOT EXISTS "mcp_invocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "agent_identity" text,
  "tool_name" text NOT NULL,
  "input_json" jsonb NOT NULL,
  "output_json" jsonb,
  "error_code" text,
  "latency_ms" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "mcp_invocations_org_created_idx" ON "mcp_invocations" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "mcp_invocations_org_tool_idx" ON "mcp_invocations" ("organization_id", "tool_name");
