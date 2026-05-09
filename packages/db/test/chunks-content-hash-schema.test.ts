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

describe('chunks content_hash schema', () => {
  it('chunks.content_hash is NOT NULL text', async () => {
    const rows = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'chunks'
         AND column_name = 'content_hash'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.data_type).toBe('text');
    expect(rows[0]!.is_nullable).toBe('NO');
  });

  it('chunks.embedding_model is NOT NULL text with default containing openai-3-small', async () => {
    const rows = await sql<
      { column_name: string; data_type: string; is_nullable: string; column_default: string }[]
    >`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'chunks'
         AND column_name = 'embedding_model'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.data_type).toBe('text');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default).toContain('openai-3-small');
  });

  it('indexes chunks_content_hash_idx and chunks_metadata_pr_idx exist', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'chunks'
         AND indexname IN ('chunks_content_hash_idx', 'chunks_metadata_pr_idx')
       ORDER BY indexname
    `;
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('chunks_content_hash_idx');
    expect(names).toContain('chunks_metadata_pr_idx');
  });

  it('metadata @> jsonb probe query does not error (GIN index smoke test)', async () => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*) AS count
        FROM chunks
       WHERE metadata @> '{"pr":{"number":1}}'::jsonb
    `;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(0);
  });
});
