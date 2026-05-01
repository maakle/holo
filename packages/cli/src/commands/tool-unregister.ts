import type { DB } from '@holo/db';
import { deleteCustomToolByName } from '@holo/custom-tools';

export async function runToolUnregister(input: {
  db: DB;
  organizationId: string;
  name: string;
}): Promise<boolean> {
  return deleteCustomToolByName(input.db, input.organizationId, input.name);
}
