import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
  sql = postgres(url, { max: 1 });
});
afterAll(async () => {
  // Clean up probe rows
  await sql`DELETE FROM connector_cursors WHERE scope = 'probe-metadata-test'`;
  await sql`DELETE FROM sources WHERE external_id = 'probe-metadata-test'`;
  await sql.end();
});

describe('connector_cursors.metadata schema', () => {
  it('metadata column is jsonb, NOT NULL, with default containing {}', async () => {
    const rows = await sql<
      { column_name: string; data_type: string; is_nullable: string; column_default: string }[]
    >`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'connector_cursors'
         AND column_name = 'metadata'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.data_type).toBe('jsonb');
    expect(rows[0]!.is_nullable).toBe('NO');
    expect(rows[0]!.column_default).toContain("'{}'");
  });

  it('jsonb_set on metadata persists nested checkpoint values', async () => {
    // Insert a probe source row (needed as FK for connector_cursors)
    await sql`
      INSERT INTO sources (id, organization_id, provider, external_id, name)
      SELECT gen_random_uuid(), o.id, 'github', 'probe-metadata-test', 'probe-metadata-test'
        FROM organization o
       WHERE o.slug = 'default'
       LIMIT 1
      ON CONFLICT DO NOTHING
    `;

    // Insert a probe connector_cursors row referencing the probe source
    await sql`
      INSERT INTO connector_cursors (id, organization_id, source_id, scope, metadata)
      SELECT gen_random_uuid(), s.organization_id, s.id, 'probe-metadata-test', '{}'::jsonb
        FROM sources s
       WHERE s.external_id = 'probe-metadata-test'
       LIMIT 1
      ON CONFLICT DO NOTHING
    `;

    // Use jsonb_set to write a nested checkpoint value.
    // PostgreSQL's jsonb_set with create_missing=true only creates the final key,
    // so intermediate keys must be seeded first before the deep path is set.
    const rows = await sql<{ metadata: Record<string, unknown> }[]>`
      UPDATE connector_cursors
         SET metadata = jsonb_set(
               jsonb_set(
                 jsonb_set(metadata, '{checkpoints}', '{}'::jsonb, true),
                 '{checkpoints,jobX}', '{}'::jsonb, true
               ),
               '{checkpoints,jobX,step1}', '"done"'::jsonb, true
             )
       WHERE scope = 'probe-metadata-test'
       RETURNING metadata
    `;

    expect(rows.length).toBe(1);
    const checkpoints = rows[0]!.metadata['checkpoints'] as Record<string, unknown>;
    const jobX = checkpoints['jobX'] as Record<string, unknown>;
    expect(jobX['step1']).toBe('done');
  });
});
