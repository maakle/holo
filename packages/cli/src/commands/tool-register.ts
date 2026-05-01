import { readFileSync } from 'node:fs';
import type { DB } from '@holo/db';
import { createCustomTool } from '@holo/custom-tools';
import { holoError, ErrorCode } from '@holo/errors';

export interface RunToolRegisterInput {
  db: DB;
  organizationId: string;
  userId: string;
  name: string;
  description: string;
  command: string;
  schemaFile: string;
  argsTemplate: string[];
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export async function runToolRegister(input: RunToolRegisterInput): Promise<string> {
  let inputSchema: Record<string, unknown>;
  try {
    const raw = readFileSync(input.schemaFile, 'utf8');
    inputSchema = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(err);
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Could not read schema file ${input.schemaFile}`,
      fix: 'Verify the path and that the file is valid JSON.',
    });
  }
  return createCustomTool(input.db, {
    organizationId: input.organizationId,
    createdBy: input.userId,
    name: input.name,
    description: input.description,
    command: input.command,
    argsTemplate: input.argsTemplate,
    inputSchema,
    envAllowlist: input.envAllowlist,
    scope: input.scope,
    readOnly: input.readOnly,
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
  });
}
