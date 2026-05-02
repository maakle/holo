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

describe('custom_tools schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'custom_tools'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'args_template',
        'command',
        'created_at',
        'created_by',
        'description',
        'env_allowlist',
        'id',
        'input_schema',
        'max_output_bytes',
        'name',
        'organization_id',
        'read_only',
        'scope',
        'timeout_ms',
      ].sort(),
    );
  });

  it('has unique (organization_id, name) index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'custom_tools'
    `;
    expect(rows.map((r) => r.indexname)).toContain('custom_tools_org_name_uniq');
  });
});
