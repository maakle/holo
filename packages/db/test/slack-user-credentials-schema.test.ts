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

describe('slack_user_credentials schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'slack_user_credentials'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'access_token_encrypted',
        'connected_at',
        'id',
        'organization_id',
        'scopes',
        'slack_user_id',
        'user_id',
      ].sort(),
    );
  });

  it('has the unique index on user_id', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'slack_user_credentials'
         AND indexname = 'slack_user_credentials_user_id_uniq'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/i);
  });
});
