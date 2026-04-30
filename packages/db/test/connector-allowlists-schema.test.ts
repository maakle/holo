import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
  sql = postgres(url, { max: 1 });
});
afterAll(async () => {
  await sql.end();
});

describe('connector_allowlists schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<
      { column_name: string; data_type: string; is_nullable: string }[]
    >`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'connector_allowlists'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'created_at',
        'created_by',
        'decision',
        'id',
        'notes',
        'organization_id',
        'pattern',
        'pattern_kind',
        'provider',
      ].sort(),
    );
  });

  it('has the org+provider index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'connector_allowlists'
    `;
    expect(rows.map((r) => r.indexname)).toContain('connector_allowlists_org_provider_idx');
  });
});
