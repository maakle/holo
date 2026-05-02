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

describe('oauth_auth_codes schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'oauth_auth_codes'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'client_id',
        'code',
        'code_challenge',
        'code_challenge_method',
        'consumed_at',
        'created_at',
        'expires_at',
        'id',
        'organization_id',
        'redirect_uri',
        'scopes',
        'user_id',
      ].sort(),
    );
  });

  it('has the unique index on code', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'oauth_auth_codes'
         AND indexname = 'oauth_auth_codes_code_uniq'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/i);
  });
});
