import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { chunkHash, dedupeAgainstDb } from '../../src/shared/content-hash';
import { makeTestDb, ensureTestOrgAndUser, seedChunks, cleanChunks } from '../helpers/db';
import type { DB } from '@holo/db';

describe('chunkHash', () => {
  it('returns sha256 hex of kind:content', () => {
    const hash = chunkHash('github-pr', 'some content');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const h1 = chunkHash('github-pr', 'same content');
    const h2 = chunkHash('github-pr', 'same content');
    expect(h1).toBe(h2);
  });

  it('differs across kind even with identical content', () => {
    const h1 = chunkHash('github-pr', 'same content');
    const h2 = chunkHash('github-issue', 'same content');
    expect(h1).not.toBe(h2);
  });
});

describe('dedupeAgainstDb', () => {
  let db: DB;
  let orgId: string;

  beforeAll(async () => {
    db = makeTestDb();
    ({ orgId } = await ensureTestOrgAndUser(db));
  });

  afterEach(async () => {
    await cleanChunks(db, orgId);
  });

  afterAll(async () => {
    await cleanChunks(db, orgId);
  });

  it('returns only hashes not already present', async () => {
    await seedChunks(db, orgId, [
      { contentHash: 'hash-existing-1', kind: 'github-pr', content: 'content 1' },
      { contentHash: 'hash-existing-2', kind: 'github-pr', content: 'content 2' },
    ]);

    const result = await dedupeAgainstDb({
      db,
      organizationId: orgId,
      hashes: ['hash-existing-1', 'hash-new-1', 'hash-existing-2', 'hash-new-2'],
    });

    expect(result).toEqual(['hash-new-1', 'hash-new-2']);
  });

  it('returns input unchanged when db has no overlapping rows', async () => {
    const result = await dedupeAgainstDb({
      db,
      organizationId: orgId,
      hashes: ['hash-a', 'hash-b', 'hash-c'],
    });

    expect(result).toEqual(['hash-a', 'hash-b', 'hash-c']);
  });

  it('returns empty array when all hashes are already present', async () => {
    await seedChunks(db, orgId, [
      { contentHash: 'hash-existing-1', kind: 'github-pr', content: 'content 1' },
      { contentHash: 'hash-existing-2', kind: 'github-pr', content: 'content 2' },
    ]);

    const result = await dedupeAgainstDb({
      db,
      organizationId: orgId,
      hashes: ['hash-existing-1', 'hash-existing-2'],
    });

    expect(result).toEqual([]);
  });

  it('scopes by organizationId — other orgs do not affect dedupe', async () => {
    // Seed chunks under a DIFFERENT org ID (a random UUID that won't exist)
    const otherOrgId = '00000000-0000-0000-0000-000000000001';

    // seed under our real org
    await seedChunks(db, orgId, [
      { contentHash: 'hash-existing-1', kind: 'github-pr', content: 'content 1' },
    ]);

    // query with a different org — should see hash-existing-1 as new
    const result = await dedupeAgainstDb({
      db,
      organizationId: otherOrgId,
      hashes: ['hash-existing-1', 'hash-new-1'],
    });

    expect(result).toEqual(['hash-existing-1', 'hash-new-1']);
  });

  it('returns empty array for empty input without hitting the db', async () => {
    const result = await dedupeAgainstDb({
      db,
      organizationId: orgId,
      hashes: [],
    });

    expect(result).toEqual([]);
  });
});
