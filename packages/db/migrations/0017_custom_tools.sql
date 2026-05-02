CREATE TABLE IF NOT EXISTS "custom_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "name" text NOT NULL,
  "description" text NOT NULL,
  "command" text NOT NULL,
  "args_template" text[] NOT NULL DEFAULT '{}'::text[],
  "input_schema" jsonb NOT NULL,
  "env_allowlist" text[] NOT NULL DEFAULT '{}'::text[],
  "scope" text,
  "read_only" boolean NOT NULL DEFAULT false,
  "timeout_ms" integer NOT NULL DEFAULT 30000,
  "max_output_bytes" integer NOT NULL DEFAULT 262144,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "user"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_tools_org_name_uniq"
  ON "custom_tools" ("organization_id", "name");

CREATE INDEX IF NOT EXISTS "custom_tools_org_idx"
  ON "custom_tools" ("organization_id");
