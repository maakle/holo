import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const REQUIRED_INDEXES: Array<{ table: string; index: string; method: string }> = [
  { table: 'chunks', index: 'chunks_embedding_hnsw_idx', method: 'hnsw' },
  { table: 'chunks', index: 'chunks_content_tsvector_gin_idx', method: 'gin' },
  { table: 'chunks', index: 'chunks_acl_subjects_gin_idx', method: 'gin' },
  { table: 'chunks', index: 'chunks_provider_source_kind_idx', method: 'btree' },
  { table: 'chunks', index: 'chunks_content_hash_idx', method: 'btree' },
  { table: 'chunks', index: 'chunks_metadata_pr_idx', method: 'gin' },
  { table: 'connector_cursors', index: 'connector_cursors_source_scope_idx', method: 'btree' },
  { table: 'source_artifacts', index: 'source_artifacts_source_kind_fetched_idx', method: 'btree' },
  {
    table: 'connector_credentials',
    index: 'connector_credentials_org_provider_idx',
    method: 'btree',
  },
  { table: 'sources', index: 'sources_org_provider_idx', method: 'btree' },
];

const REQUIRED_TABLES = [
  'organization',
  'user',
  'session',
  'account',
  'verification',
  'connector_allowlists',
  'connector_credentials',
  'sources',
  'source_artifacts',
  'chunks',
  'connector_cursors',
  'custom_tools',
];

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
  sql = postgres(url, { max: 1 });
});
afterAll(async () => {
  await sql.end();
});

describe('schema presence', () => {
  it('has the pgvector extension installed', async () => {
    const rows = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows.length).toBe(1);
  });

  it.each(REQUIRED_TABLES)('has table %s', async (tbl) => {
    const rows = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tbl}
    `;
    expect(rows.length).toBe(1);
  });

  it.each(REQUIRED_INDEXES)(
    'has index $index on $table using $method',
    async ({ index, method }) => {
      const rows = await sql`
        SELECT i.indexname, am.amname AS method
        FROM pg_indexes i
        JOIN pg_class c ON c.relname = i.indexname
        JOIN pg_index pi ON pi.indexrelid = c.oid
        JOIN pg_am am ON am.oid = c.relam
        WHERE i.schemaname = 'public' AND i.indexname = ${index}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]!.method).toBe(method);
    },
  );

  it('chunks.embedding column has dimension 1024', async () => {
    const rows = await sql`
      SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'
    `;
    expect(rows[0]!.atttypmod).toBe(1024);
  });

  it('default organization is seeded', async () => {
    const rows = await sql`SELECT slug FROM organization WHERE slug = 'default'`;
    expect(rows.length).toBe(1);
  });
});
