import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDb } from '@holo/db';
import { runSlackSubjectsSync } from '../src/sync-runner';
import type { SlackChannelLister } from '../src/slack-resolver';

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
  await sql`DELETE FROM audit_events WHERE user_id = ${userId} AND event_type = 'user_subjects.refreshed'`;
});

function fakeClient(channels: string[]): SlackChannelLister {
  return {
    async usersConversations() {
      return { channels: channels.map((id) => ({ id })) };
    },
  };
}

describe('runSlackSubjectsSync', () => {
  it('writes resolved subjects to cache and emits audit event', async () => {
    const result = await runSlackSubjectsSync({
      db,
      userId,
      organizationId: orgId,
      client: fakeClient(['C1', 'C2', 'C3']),
    });
    expect(result.count).toBe(3);

    const subjects = await sql<{ subject: string }[]>`
      SELECT subject FROM user_subjects_cache WHERE user_id = ${userId} ORDER BY subject
    `;
    expect(subjects.map((r) => r.subject)).toEqual([
      'slack-channel:C1',
      'slack-channel:C2',
      'slack-channel:C3',
    ]);

    let auditRow: { meta: Record<string, unknown> } | undefined;
    for (let i = 0; i < 20 && !auditRow; i++) {
      const rows = await sql<{ meta: Record<string, unknown> }[]>`
        SELECT meta FROM audit_events
         WHERE user_id = ${userId}
           AND event_type = 'user_subjects.refreshed'
         ORDER BY created_at DESC
         LIMIT 1
      `;
      auditRow = rows[0];
      if (!auditRow) await new Promise((r) => setTimeout(r, 50));
    }
    expect(auditRow).toBeDefined();
    expect(auditRow!.meta.source).toBe('slack');
    expect(auditRow!.meta.count).toBe(3);
  });

  it('dropping channels reflects in next sync', async () => {
    await runSlackSubjectsSync({
      db,
      userId,
      organizationId: orgId,
      client: fakeClient(['C1', 'C2']),
    });
    const result = await runSlackSubjectsSync({
      db,
      userId,
      organizationId: orgId,
      client: fakeClient(['C2']),
    });
    expect(result.count).toBe(1);

    const subjects = await sql<{ subject: string }[]>`
      SELECT subject FROM user_subjects_cache WHERE user_id = ${userId}
    `;
    expect(subjects).toEqual([{ subject: 'slack-channel:C2' }]);
  });
});
