import type { DB } from '@holo/db';
import { getCustomToolByName } from '@holo/custom-tools';
import { holoError, ErrorCode } from '@holo/errors';

export async function runToolShow(input: {
  db: DB;
  organizationId: string;
  name: string;
}): Promise<string> {
  const row = await getCustomToolByName(input.db, input.organizationId, input.name);
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `Custom tool '${input.name}' not found`,
      fix: 'Run `holo tool list` to see registered tools.',
    });
  }
  return JSON.stringify(row, null, 2) + '\n';
}
