/**
 * Per-user ACL fan-out integration test.
 *
 * Approach: direct SQL against the `chunks.acl_subjects && $userSubjects::text[]`
 * filter. We chose this over invoking `@holo/retrieval-core`'s `search()` because:
 *
 *   1. `search()` calls `embedQuery()` which requires a real embedding provider
 *      API key — those aren't reliably available in the test environment.
 *   2. The load-bearing invariant of this slice is the SQL ACL filter, not the
 *      hybrid-search ranking. Test 1 (`oauth-roundtrip`) already exercises the
 *      app-level wiring through MCP.
 *
 * This test seeds two chunks with distinct `acl_subjects`, then runs the same
 * filter the production `search()` uses against two different `userSubjects`
 * arrays (Alice's, which includes `slack-channel:C1`, and Bob's, which doesn't),
 * asserting the right rows surface in each case.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

let sql: ReturnType<typeof postgres>;
let orgId: string;
let sourceId: string;
let artifactAId: string;
let artifactBId: string;
let chunkAId: string;
let chunkBId: string;

const SEED = `acl-test-${Date.now()}`;
const CHANNEL_SUBJECT = `slack-channel:C1-${SEED}`;
const CHUNK_A_MARKER = `CHANNEL_C1_SECRET_${SEED}`;
const CHUNK_B_MARKER = `ORG_PUBLIC_${SEED}`;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });

  const orgRows = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  if (!orgRows[0]) throw new Error('No organization seeded');
  orgId = orgRows[0].id;

  // Seed a synthetic source so we can attach artifacts to it.
  const sourceRows = await sql<{ id: string }[]>`
    INSERT INTO sources (organization_id, provider, external_id, name)
    VALUES (${orgId}, 'slack', ${`source-${SEED}`}, ${`acl-test-source-${SEED}`})
    RETURNING id
  `;
  sourceId = sourceRows[0]!.id;

  const aRows = await sql<{ id: string }[]>`
    INSERT INTO source_artifacts (organization_id, source_id, external_id, kind, payload)
    VALUES (${orgId}, ${sourceId}, ${`artifact-a-${SEED}`}, 'message', '{}'::jsonb)
    RETURNING id
  `;
  artifactAId = aRows[0]!.id;

  const bRows = await sql<{ id: string }[]>`
    INSERT INTO source_artifacts (organization_id, source_id, external_id, kind, payload)
    VALUES (${orgId}, ${sourceId}, ${`artifact-b-${SEED}`}, 'message', '{}'::jsonb)
    RETURNING id
  `;
  artifactBId = bRows[0]!.id;

  // Chunk A: gated by slack-channel:C1 ONLY — only members of that channel
  // (i.e., Alice, who has the subject cached) should see it. Note we deliberately
  // omit `org:${orgId}` so that the channel subject is the load-bearing gate.
  const chunkARows = await sql<{ id: string }[]>`
    INSERT INTO chunks (
      organization_id, source_artifact_id, kind, content, content_hash,
      embedding_model, acl_subjects, provider, source_id
    )
    VALUES (
      ${orgId}, ${artifactAId}, 'text', ${CHUNK_A_MARKER}, ${`hash-a-${SEED}`},
      'openai-3-small',
      ARRAY[${CHANNEL_SUBJECT}]::text[],
      'slack', ${sourceId}
    )
    RETURNING id
  `;
  chunkAId = chunkARows[0]!.id;

  // Chunk B: gated by org only (everyone in the org sees it)
  const chunkBRows = await sql<{ id: string }[]>`
    INSERT INTO chunks (
      organization_id, source_artifact_id, kind, content, content_hash,
      embedding_model, acl_subjects, provider, source_id
    )
    VALUES (
      ${orgId}, ${artifactBId}, 'text', ${CHUNK_B_MARKER}, ${`hash-b-${SEED}`},
      'openai-3-small',
      ARRAY[${`org:${orgId}`}]::text[],
      'slack', ${sourceId}
    )
    RETURNING id
  `;
  chunkBId = chunkBRows[0]!.id;
});

afterAll(async () => {
  await sql`DELETE FROM chunks WHERE id IN (${chunkAId}, ${chunkBId})`.catch(() => {});
  await sql`DELETE FROM source_artifacts WHERE id IN (${artifactAId}, ${artifactBId})`.catch(() => {});
  await sql`DELETE FROM sources WHERE id = ${sourceId}`.catch(() => {});
  await sql.end();
});

/**
 * Mirrors the SQL filter used inside `@holo/retrieval-core`'s `search()`:
 *   acl_subjects && $userSubjects::text[]
 * Returns the chunk ids that the given user would be permitted to retrieve.
 */
async function aclFilteredIds(userSubjects: string[]): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM chunks
    WHERE organization_id = ${orgId}
      AND id IN (${chunkAId}, ${chunkBId})
      AND acl_subjects && ${userSubjects}::text[]
  `;
  return rows.map((r) => r.id);
}

describe('per-user ACL fan-out', () => {
  it('Alice (with slack-channel:C1 cached) sees both chunks', async () => {
    const aliceSubjects = [`org:${orgId}`, 'user:alice', CHANNEL_SUBJECT];
    const ids = await aclFilteredIds(aliceSubjects);
    expect(ids).toContain(chunkAId);
    expect(ids).toContain(chunkBId);
  });

  it('Bob (no channel cache) only sees the org-public chunk', async () => {
    const bobSubjects = [`org:${orgId}`, 'user:bob'];
    const ids = await aclFilteredIds(bobSubjects);
    expect(ids).not.toContain(chunkAId);
    expect(ids).toContain(chunkBId);
  });

  it('user with no org subject sees nothing', async () => {
    const strangerSubjects = ['user:stranger'];
    const ids = await aclFilteredIds(strangerSubjects);
    expect(ids).not.toContain(chunkAId);
    expect(ids).not.toContain(chunkBId);
  });

  it('SQL filter is symmetric — adding the channel subject reveals the gated chunk', async () => {
    const before = await aclFilteredIds([`org:${orgId}`, 'user:bob']);
    const after = await aclFilteredIds([`org:${orgId}`, 'user:bob', CHANNEL_SUBJECT]);
    expect(before).not.toContain(chunkAId);
    expect(after).toContain(chunkAId);
  });
});
