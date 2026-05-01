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

describe('skills schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<
      { column_name: string; data_type: string; is_nullable: string }[]
    >`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'skills'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'content',
        'created_at',
        'created_by',
        'fingerprint',
        'id',
        'name',
        'organization_id',
        'slug',
        'source_artifact_ids',
        'stale_at',
        'status',
        'updated_at',
        'version',
      ].sort(),
    );
  });

  it('has the org+status index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'skills'
    `;
    expect(rows.map((r) => r.indexname)).toContain('skills_org_status_idx');
  });

  it('has the unique index on (organization_id, slug, version)', async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'skills'
         AND indexname = 'skills_org_slug_version_uniq'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.indexdef).toMatch(/UNIQUE/i);
  });
});
