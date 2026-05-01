import { sql } from 'drizzle-orm';
import Table from 'cli-table3';
import type { DB } from '@holo/db';

export interface RenderListGithubInput {
  db: DB;
  organizationId: string;
}

type Row = {
  id: string;
  pattern: string;
  pattern_kind: string;
  decision: string;
  notes: string | null;
  created_at: Date;
} & Record<string, unknown>;

export async function renderListGithub(input: RenderListGithubInput): Promise<string> {
  const result = await input.db.execute<Row>(sql`
    SELECT id, pattern, pattern_kind, decision, notes, created_at
    FROM connector_allowlists
    WHERE organization_id = ${input.organizationId} AND provider = 'github'
    ORDER BY created_at ASC
  `);
  const rows = (result as unknown as { rows?: Row[] }).rows
    ?? (result as unknown as Row[]);

  if (!rows || rows.length === 0) {
    return 'no github allowlist patterns — add one with `holo allowlist add github <pattern>`\n';
  }

  const table = new Table({
    head: ['id', 'pattern', 'kind', 'decision', 'notes', 'created'],
    colWidths: [38, 32, 10, 10, 24, 22],
    wordWrap: true,
  });
  for (const r of rows) {
    table.push([
      r.id,
      r.pattern,
      r.pattern_kind,
      r.decision,
      r.notes ?? '',
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    ]);
  }
  return table.toString() + '\n';
}
