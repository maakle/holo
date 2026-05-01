import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

export interface RunAllowlistRemoveInput {
  db: DB;
  organizationId: string;
  id: string;
}

export async function runAllowlistRemove(input: RunAllowlistRemoveInput): Promise<void> {
  const result = await input.db.execute<{ id: string }>(sql`
    DELETE FROM connector_allowlists
    WHERE id = ${input.id} AND organization_id = ${input.organizationId}
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (result as unknown as Array<{ id: string }>);
  if (!rows || rows.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `no allowlist row with id ${input.id} for this organization`,
      fix: '`holo allowlist list <provider>` to list ids',
    });
  }
}
