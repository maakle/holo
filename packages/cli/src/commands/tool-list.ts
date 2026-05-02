import type { DB } from '@holo/db';
import { listCustomTools } from '@holo/custom-tools';

export async function runToolList(input: { db: DB; organizationId: string }): Promise<string> {
  const rows = await listCustomTools(input.db, input.organizationId);
  if (rows.length === 0) return 'no custom tools registered\n';
  const lines = rows.map(
    (r) =>
      `${r.name}\t${r.command}\t${r.readOnly ? 'read-only' : 'read-write'}\t${r.scope ?? ''}`,
  );
  return `name\tcommand\tmode\tscope\n${lines.join('\n')}\n`;
}
