import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { getSubjectsForUser, replaceSubjectsForUser } from '../src/repository.js';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let orgId: string;
let userId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);
  const orgRow = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  const userRow = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  orgId = orgRow[0]!.id;
  userId = userRow[0]!.id;
});

afterAll(async () => {
  await sql`DELETE FROM user_subjects_cache WHERE user_id = ${userId}`.catch(() => {});
  await sql.end();
});

beforeEach(async () => {
  await sql`DELETE FROM user_subjects_cache WHERE user_id = ${userId}`;
});

describe('getSubjectsForUser', () => {
  it('returns empty array when no rows', async () => {
    expect(await getSubjectsForUser(db, userId)).toEqual([]);
  });

  it('returns subjects sorted ascending', async () => {
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C2', 'slack-channel:C1', 'slack-channel:C3'],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
      'slack-channel:C3',
    ]);
  });
});

describe('replaceSubjectsForUser', () => {
  it('inserts subjects on first call', async () => {
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1', 'slack-channel:C2'],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
    ]);
  });

  it('replaces only its own source — leaves other sources untouched', async () => {
    // Seed an unrelated row from a hypothetical future source via raw SQL.
    await sql`
      INSERT INTO user_subjects_cache (user_id, organization_id, subject, source)
      VALUES (${userId}, ${orgId}, 'github-repo:foo/bar', 'github')
    `;
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1'],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual([
      'github-repo:foo/bar',
      'slack-channel:C1',
    ]);
  });

  it('drops subjects no longer present (user left a channel)', async () => {
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1', 'slack-channel:C2'],
    });
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C2'],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual(['slack-channel:C2']);
  });

  it('handles empty subject set (clears all of source)', async () => {
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1'],
    });
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: [],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual([]);
  });

  it('deduplicates within input (insert-or-ignore semantics on (user_id, subject))', async () => {
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1', 'slack-channel:C1', 'slack-channel:C2'],
    });
    expect(await getSubjectsForUser(db, userId)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
    ]);
  });

  it('refreshed_at is set on insert', async () => {
    const before = Date.now();
    await replaceSubjectsForUser(db, {
      userId,
      organizationId: orgId,
      source: 'slack',
      subjects: ['slack-channel:C1'],
    });
    const rows = await sql<{ refreshed_at: Date }[]>`
      SELECT refreshed_at FROM user_subjects_cache WHERE user_id = ${userId}
    `;
    expect(rows[0]!.refreshed_at.getTime()).toBeGreaterThanOrEqual(before - 100);
  });
});
