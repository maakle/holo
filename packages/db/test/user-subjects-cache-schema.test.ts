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

describe('user_subjects_cache schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_subjects_cache'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'id',
        'organization_id',
        'refreshed_at',
        'source',
        'subject',
        'user_id',
      ].sort(),
    );
  });

  it('has the unique index on (user_id, subject)', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'user_subjects_cache'
         AND indexname = 'user_subjects_cache_user_subject_uniq'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/i);
  });
});
