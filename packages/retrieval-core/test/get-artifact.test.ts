import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DB } from '@holo/db';
import { getArtifact } from '../src/get-artifact.js';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let db: DB;
let orgId: string;

const TEST_SLUG = 'test-retrieval-core';

beforeAll(async () => {
  db = createDb(url);
  const orgRes = await db.execute<{ id: string }>(sql`
    INSERT INTO organization (slug, name) VALUES (${TEST_SLUG}, 'retrieval test org')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  orgId = ((orgRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (orgRes as unknown as Array<{ id: string }>))[0]!.id;
});

async function cleanArtifacts(): Promise<void> {
  await db.execute(sql`DELETE FROM sources WHERE organization_id = ${orgId}`);
}

afterEach(async () => {
  await cleanArtifacts();
});

afterAll(async () => {
  await cleanArtifacts();
});

interface SeedSpec {
  artifactKind: string;
  chunks: Array<{
    kind: string;
    content: string;
    metadata: Record<string, unknown>;
  }>;
}

async function seedArtifact(spec: SeedSpec): Promise<string> {
  const sourceRes = await db.execute<{ id: string }>(sql`
    INSERT INTO sources (organization_id, provider, external_id, name)
    VALUES (${orgId}, 'github', ${'test-' + Math.random().toString(36).slice(2)}, 'test')
    RETURNING id
  `);
  const sourceId = ((sourceRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (sourceRes as unknown as Array<{ id: string }>))[0]!.id;

  const artifactRes = await db.execute<{ id: string }>(sql`
    INSERT INTO source_artifacts
      (organization_id, source_id, kind, external_id, fetched_at, payload)
    VALUES (${orgId}, ${sourceId}, ${spec.artifactKind}, 'test-art', now(), '{}'::jsonb)
    RETURNING id
  `);
  const artifactId = ((artifactRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (artifactRes as unknown as Array<{ id: string }>))[0]!.id;

  for (const c of spec.chunks) {
    const hash = `hash-${Math.random().toString(36).slice(2)}`;
    await db.execute(sql`
      INSERT INTO chunks
        (organization_id, source_id, source_artifact_id, kind, content, content_hash,
         provider, metadata, acl_subjects)
      VALUES (
        ${orgId}, ${sourceId}, ${artifactId}, ${c.kind}, ${c.content},
        ${hash}, 'github', ${JSON.stringify(c.metadata)}::jsonb,
        ARRAY[${'org:' + orgId}]::text[]
      )
    `);
  }

  return artifactId;
}

describe('getArtifact', () => {
  it('orders PR chunks: title → diff → review regardless of insert order', async () => {
    const artifactId = await seedArtifact({
      artifactKind: 'pr',
      chunks: [
        { kind: 'github-pr', content: 'review body', metadata: { kind: 'review' } },
        { kind: 'github-pr', content: 'title body', metadata: { kind: 'title' } },
        { kind: 'github-pr', content: 'diff body', metadata: { kind: 'diff' } },
      ],
    });

    const result = await getArtifact({ db, artifactId, organizationId: orgId });
    expect(result.artifactKind).toBe('pr');
    expect(result.ordered.map((c) => c.metadata['kind'])).toEqual(['title', 'diff', 'review']);
    expect(result.chunks).toHaveLength(3);
  });

  it('orders doc chunks by chunk_index ascending', async () => {
    const artifactId = await seedArtifact({
      artifactKind: 'doc',
      chunks: [
        { kind: 'github-doc', content: 'two', metadata: { chunk_index: 2 } },
        { kind: 'github-doc', content: 'zero', metadata: { chunk_index: 0 } },
        { kind: 'github-doc', content: 'three', metadata: { chunk_index: 3 } },
        { kind: 'github-doc', content: 'one', metadata: { chunk_index: 1 } },
      ],
    });
    const result = await getArtifact({ db, artifactId, organizationId: orgId });
    expect(result.ordered.map((c) => c.metadata['chunk_index'])).toEqual([0, 1, 2, 3]);
  });

  it('throws HOLO_ARTIFACT_NOT_FOUND for unknown id', async () => {
    await expect(
      getArtifact({
        db,
        artifactId: '00000000-0000-0000-0000-0000DEADBEE0',
        organizationId: orgId,
      }),
    ).rejects.toMatchObject({ code: 'HOLO_ARTIFACT_NOT_FOUND' });
  });

  it('orders Notion page: kind=page first, then blocks by block_id lex', async () => {
    const artifactId = await seedArtifact({
      artifactKind: 'notion-page',
      chunks: [
        { kind: 'notion-page', content: 'block C', metadata: { kind: 'block', block_id: 'block-c' } },
        { kind: 'notion-page', content: 'page summary', metadata: { kind: 'page' } },
        { kind: 'notion-page', content: 'block A', metadata: { kind: 'block', block_id: 'block-a' } },
        { kind: 'notion-page', content: 'block B', metadata: { kind: 'block', block_id: 'block-b' } },
      ],
    });
    const result = await getArtifact({ db, artifactId, organizationId: orgId });
    expect(result.ordered[0]!.metadata['kind']).toBe('page');
    expect(result.ordered.slice(1).map((c) => c.metadata['block_id'])).toEqual([
      'block-a',
      'block-b',
      'block-c',
    ]);
  });
});
