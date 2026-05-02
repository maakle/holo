import { and, eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import type { CustomToolRow } from './types.js';

// keep in sync with apps/mcp/src/tools/index.ts
const BUILTIN_TOOL_NAMES = new Set([
  'search',
  'get_pr',
  'get_thread',
  'get_doc',
  'get_call',
  'get_ticket',
  'list_skills',
  'get_skill',
  'execute_skill',
]);

export async function listCustomTools(
  db: DB,
  organizationId: string,
): Promise<CustomToolRow[]> {
  const rows = await db
    .select()
    .from(schema.customTools)
    .where(eq(schema.customTools.organizationId, organizationId));
  return rows.map(toRow);
}

export async function getCustomToolByName(
  db: DB,
  organizationId: string,
  name: string,
): Promise<CustomToolRow | null> {
  const rows = await db
    .select()
    .from(schema.customTools)
    .where(
      and(
        eq(schema.customTools.organizationId, organizationId),
        eq(schema.customTools.name, name),
      ),
    )
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

export interface CreateCustomToolInput {
  organizationId: string;
  createdBy: string;
  name: string;
  description: string;
  command: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export async function createCustomTool(db: DB, input: CreateCustomToolInput): Promise<string> {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.name)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Custom tool name '${input.name}' is invalid`,
      fix: 'Use 3-64 chars, lowercase letters/digits/underscore, starting with a letter.',
    });
  }
  if (BUILTIN_TOOL_NAMES.has(input.name)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Custom tool name '${input.name}' collides with a built-in MCP tool`,
      fix: 'Pick a different name; built-in tool names are reserved.',
    });
  }
  if (input.timeoutMs > 60000) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `timeout_ms ${input.timeoutMs} exceeds hard ceiling 60000`,
      fix: 'Set --timeout-ms to 60000 or less.',
    });
  }
  if (input.maxOutputBytes > 1_048_576) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `max_output_bytes ${input.maxOutputBytes} exceeds hard ceiling 1048576`,
      fix: 'Set --max-output-bytes to 1048576 or less.',
    });
  }
  const [row] = await db
    .insert(schema.customTools)
    .values({
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      name: input.name,
      description: input.description,
      command: input.command,
      argsTemplate: input.argsTemplate,
      inputSchema: input.inputSchema,
      envAllowlist: input.envAllowlist,
      scope: input.scope,
      readOnly: input.readOnly,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    })
    .returning({ id: schema.customTools.id });
  return row!.id;
}

export async function deleteCustomToolByName(
  db: DB,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .delete(schema.customTools)
    .where(
      and(
        eq(schema.customTools.organizationId, organizationId),
        eq(schema.customTools.name, name),
      ),
    )
    .returning({ id: schema.customTools.id });
  return result.length > 0;
}

function toRow(r: typeof schema.customTools.$inferSelect): CustomToolRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    command: r.command,
    argsTemplate: r.argsTemplate,
    inputSchema: r.inputSchema as Record<string, unknown>,
    envAllowlist: r.envAllowlist,
    scope: r.scope,
    readOnly: r.readOnly,
    timeoutMs: r.timeoutMs,
    maxOutputBytes: r.maxOutputBytes,
  };
}
