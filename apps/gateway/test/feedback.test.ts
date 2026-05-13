import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { Hono } from 'hono';
import { createDb } from '@holo/db';
import { HoloError } from '@holo/errors';
import { createRestRouter } from '../src/rest/router.js';

/**
 * Feedback endpoint integration test (RFC-0008).
 *
 * Strategy: mount the rest router behind a stub session middleware that
 * injects a known org + user, POST /v1/feedback twice with the same
 * answer_id, and assert that:
 *   1. The first POST inserts a row.
 *   2. The second POST UPSERTs (no duplicate row; rating/correction updated).
 *
 * Requires DATABASE_URL — the suite is opt-in via the env var, matching
 * the rest of the gateway integration tests.
 */

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let app: Hono;
let orgId: string;
let userId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);

  const orgRows = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  if (!orgRows[0]) throw new Error('No organization seeded — run db migrations/seed first');
  orgId = orgRows[0].id;

  const userRows = await sql<{ id: string }[]>`
    SELECT id FROM "user" WHERE organization_id = ${orgId} LIMIT 1
  `;
  if (userRows[0]) {
    userId = userRows[0].id;
  } else {
    const inserted = await sql<{ id: string }[]>`
      INSERT INTO "user" (email, organization_id)
      VALUES (${`feedback-test-${Date.now()}@test.local`}, ${orgId})
      RETURNING id
    `;
    userId = inserted[0]!.id;
  }

  app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HoloError) return c.json(err.toJSON(), 400);
    return c.json({ problem: (err as Error).message }, 500);
  });
  // Stub session middleware that pins the request to our test user/org.
  app.use('*', async (c, next) => {
    c.set('user', { userId, organizationId: orgId, email: '', agentIdentity: 'test' });
    await next();
  });
  const restRouter = createRestRouter(db);
  app.route('/', restRouter);
});

afterAll(async () => {
  // Clean up our feedback rows so re-runs stay deterministic.
  await sql`DELETE FROM answer_feedback WHERE user_id = ${userId}`;
  await sql.end();
});

describe('POST /v1/feedback', () => {
  it('inserts a feedback row and returns it', async () => {
    const answerId = crypto.randomUUID();
    const res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answer_id: answerId,
        rating: 1,
        skill_slug: 'release-rollback',
        denorm: {
          question: 'How do I rollback?',
          answer: 'Revert the deploy via the dashboard.',
          citations: [{ index: 1, chunk_id: 'c1' }],
          coverage: [],
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; answer_id: string; rating: number };
    expect(body.answer_id).toBe(answerId);
    expect(body.rating).toBe(1);

    const rows = await sql<{ id: string; rating: number }[]>`
      SELECT id, rating FROM answer_feedback WHERE answer_id = ${answerId} AND user_id = ${userId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(1);
  });

  it('is idempotent on (answer_id, user_id) — second POST UPSERTs', async () => {
    const answerId = crypto.randomUUID();
    // First: thumbs-up.
    let res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answer_id: answerId,
        rating: 1,
        denorm: {
          question: 'q',
          answer: 'a',
          citations: [],
          coverage: [],
        },
      }),
    });
    expect(res.status).toBe(200);

    // Second: thumbs-down + correction. Same answer_id, same user.
    res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answer_id: answerId,
        rating: -1,
        correction_text: 'The agent missed the runbook.',
        denorm: {
          question: 'q',
          answer: 'a',
          citations: [],
          coverage: [],
        },
      }),
    });
    expect(res.status).toBe(200);

    const rows = await sql<{ id: string; rating: number; correction_text: string | null }[]>`
      SELECT id, rating, correction_text
        FROM answer_feedback
       WHERE answer_id = ${answerId} AND user_id = ${userId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rating).toBe(-1);
    expect(rows[0]!.correction_text).toBe('The agent missed the runbook.');
  });

  it('rejects invalid ratings (must be -1, 0, or 1)', async () => {
    const res = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        answer_id: crypto.randomUUID(),
        rating: 99,
        denorm: { question: 'q', answer: 'a', citations: [], coverage: [] },
      }),
    });
    expect(res.status).toBe(400);
  });
});
