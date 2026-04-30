import { createDb, schema } from '@holo/db';
import type { DB } from '@holo/db';
import { and, eq } from 'drizzle-orm';

export function makeTestDb(): DB {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  return createDb(url);
}

export interface AllowlistRowInput {
  pattern: string;
  patternKind: 'glob' | 'exact_id';
  decision: 'include' | 'exclude';
}

/**
 * Seeds allowlist rows for the given org/provider.
 */
export async function seedAllowlistRows(
  db: DB,
  orgId: string,
  userId: string,
  provider: string,
  rows: AllowlistRowInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(schema.connectorAllowlists).values(
    rows.map((r) => ({
      organizationId: orgId,
      provider,
      pattern: r.pattern,
      patternKind: r.patternKind,
      decision: r.decision,
      createdBy: userId,
    })),
  );
}

/**
 * Remove all connector_allowlists rows for a given org + provider.
 */
export async function cleanAllowlistRows(
  db: DB,
  orgId: string,
  provider: string,
): Promise<void> {
  await db
    .delete(schema.connectorAllowlists)
    .where(
      and(
        eq(schema.connectorAllowlists.organizationId, orgId),
        eq(schema.connectorAllowlists.provider, provider),
      ),
    );
}

// ─── Chunk helpers ────────────────────────────────────────────────────────────

const CHUNK_SEED_PROVIDER = 'github';
const CHUNK_SEED_SOURCE_EXTERNAL_ID = 'test-content-hash';
const CHUNK_SEED_ARTIFACT_EXTERNAL_ID = 'test-content-hash-artifact';

export interface ChunkRowInput {
  contentHash: string;
  kind: string;
  content: string;
}

/**
 * Seeds chunk rows for the given org.
 * Idempotently creates one source + one source_artifact to satisfy FK constraints.
 * Each chunk row points at that shared artifact.
 */
export async function seedChunks(
  db: DB,
  orgId: string,
  rows: ChunkRowInput[],
): Promise<void> {
  if (rows.length === 0) return;

  // 1. Upsert source (unique on org + provider + external_id)
  await db
    .insert(schema.sources)
    .values({
      organizationId: orgId,
      provider: CHUNK_SEED_PROVIDER,
      externalId: CHUNK_SEED_SOURCE_EXTERNAL_ID,
      name: 'Test Content Hash Source',
    })
    .onConflictDoNothing();

  const source = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, orgId),
        eq(schema.sources.provider, CHUNK_SEED_PROVIDER),
        eq(schema.sources.externalId, CHUNK_SEED_SOURCE_EXTERNAL_ID),
      ),
    )
    .limit(1);

  const sourceId = source[0]!.id;

  // 2. Upsert source_artifact (unique on source_id + external_id)
  await db
    .insert(schema.sourceArtifacts)
    .values({
      organizationId: orgId,
      sourceId,
      externalId: CHUNK_SEED_ARTIFACT_EXTERNAL_ID,
      kind: 'github-pr',
      payload: {},
    })
    .onConflictDoNothing();

  const artifact = await db
    .select({ id: schema.sourceArtifacts.id })
    .from(schema.sourceArtifacts)
    .where(
      and(
        eq(schema.sourceArtifacts.sourceId, sourceId),
        eq(schema.sourceArtifacts.externalId, CHUNK_SEED_ARTIFACT_EXTERNAL_ID),
      ),
    )
    .limit(1);

  const sourceArtifactId = artifact[0]!.id;

  // 3. Insert chunks
  await db.insert(schema.chunks).values(
    rows.map((r) => ({
      organizationId: orgId,
      sourceArtifactId,
      sourceId,
      provider: CHUNK_SEED_PROVIDER,
      kind: r.kind,
      content: r.content,
      contentHash: r.contentHash,
    })),
  );
}

/**
 * Remove all chunks (and their parent source_artifact + source) for a given org
 * that were created by seedChunks. Because source_artifacts ON DELETE CASCADE
 * propagates to chunks, deleting the source is sufficient.
 */
export async function cleanChunks(db: DB, orgId: string): Promise<void> {
  // Delete source → cascades to source_artifacts → cascades to chunks
  await db
    .delete(schema.sources)
    .where(
      and(
        eq(schema.sources.organizationId, orgId),
        eq(schema.sources.provider, CHUNK_SEED_PROVIDER),
        eq(schema.sources.externalId, CHUNK_SEED_SOURCE_EXTERNAL_ID),
      ),
    );
}

// ─── Org + user helper ────────────────────────────────────────────────────────

/**
 * Ensure a test org + user exist, returning their IDs.
 * Uses a dedicated slug so tests never collide with real data.
 */
export async function ensureTestOrgAndUser(
  db: DB,
): Promise<{ orgId: string; userId: string }> {
  const TEST_ORG_SLUG = 'test-allowlist';
  const TEST_USER_EMAIL = 'test-allowlist@holo.test';

  // Upsert org
  const existingOrgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, TEST_ORG_SLUG))
    .limit(1);

  let orgId: string;
  if (existingOrgs[0]) {
    orgId = existingOrgs[0].id;
  } else {
    const inserted = await db
      .insert(schema.organization)
      .values({ name: 'Test Allowlist Org', slug: TEST_ORG_SLUG })
      .returning({ id: schema.organization.id });
    orgId = inserted[0]!.id;
  }

  // Upsert user
  const existingUsers = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, TEST_USER_EMAIL))
    .limit(1);

  let userId: string;
  if (existingUsers[0]) {
    userId = existingUsers[0].id;
  } else {
    const inserted = await db
      .insert(schema.user)
      .values({
        email: TEST_USER_EMAIL,
        name: 'Test Allowlist User',
        organizationId: orgId,
      })
      .returning({ id: schema.user.id });
    userId = inserted[0]!.id;
  }

  return { orgId, userId };
}
